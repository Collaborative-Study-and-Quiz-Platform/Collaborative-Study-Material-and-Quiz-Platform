// Builds a small .xlsx workbook in memory so tests need no spreadsheet library.
const zlib = require("node:zlib");

const CRC_TABLE = Array.from({ length: 256 }, (unused, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// files: [{ name, content, stored }]. stored = true keeps the file uncompressed.
function zip(files) {
  const parts = [];
  const directory = [];
  let offset = 0;

  files.forEach((file) => {
    const name = Buffer.from(file.name);
    const raw = Buffer.from(file.content);
    const data = file.stored ? raw : zlib.deflateRawSync(raw);
    const header = Buffer.alloc(30);

    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(file.stored ? 0 : 8, 8);
    header.writeUInt32LE(crc32(raw), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26);
    parts.push(header, name, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(file.stored ? 0 : 8, 10);
    entry.writeUInt32LE(crc32(raw), 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    directory.push(entry, name);

    offset += header.length + name.length + data.length;
  });

  const directoryBuffer = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directoryBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...parts, directoryBuffer, end]);
}

function columnLetter(index) {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

// rows: array of arrays. Strings go to the shared string table like Excel does;
// numbers and booleans are stored as typed cells; null leaves the cell empty.
function buildXlsx(rows) {
  const shared = [];
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const ref = `${columnLetter(columnIndex)}${rowIndex + 1}`;
      if (value === null || value === undefined) {
        return "";
      }
      if (typeof value === "number") {
        return `<c r="${ref}"><v>${value}</v></c>`;
      }
      if (typeof value === "boolean") {
        return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
      }
      shared.push(value);
      return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
    });
    return `<row r="${rowIndex + 1}">${cells.join("")}</row>`;
  });

  return zip([
    { name: "[Content_Types].xml", content: "<Types/>" },
    {
      name: "xl/workbook.xml",
      content: "<workbook xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">"
        + "<sheets><sheet name=\"Questions\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>"
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: "<Relationships><Relationship Id=\"rId1\" Type=\"worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>"
    },
    {
      name: "xl/sharedStrings.xml",
      content: `<sst>${shared.map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`).join("")}</sst>`,
      stored: true
    },
    { name: "xl/worksheets/sheet1.xml", content: `<worksheet><sheetData>${sheetRows.join("")}</sheetData></worksheet>` }
  ]);
}

module.exports = { buildXlsx };