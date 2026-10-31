// Reads question import files (.csv or .xlsx) into plain rows of text.
// No third-party libraries: CSV is parsed here and an .xlsx workbook (a zip of
// XML files) is read with Node's built-in zlib.
const zlib = require("node:zlib");

const MAX_UNZIPPED_BYTES = 20 * 1024 * 1024;
const REQUIRED_COLUMNS = ["text", "type", "subject", "topic", "difficulty"];

// Header names accepted for each field (compared in lower case, letters and digits only)
const COLUMN_ALIASES = {
  text: ["text", "question", "questiontext"],
  type: ["type", "questiontype"],
  subject: ["subject"],
  topic: ["topic"],
  difficulty: ["difficulty", "level"],
  options: ["options", "choices"],
  correctAnswer: ["correctanswer", "answer", "correct"]
};
const OPTION_COLUMN = /^option([a-f1-6])$/;

class ImportFileError extends Error {}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0];
  let best = ",";
  let bestCount = 0;

  [",", ";", "\t"].forEach((delimiter) => {
    const count = firstLine.split(delimiter).length - 1;
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  });
  return best;
}

// Returns [{ rowNumber, cells: [text, ...] }]. Handles quoted fields, doubled
// quotes, line breaks inside quotes, CRLF line endings and a leading BOM.
function parseCsv(input) {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  function endField() {
    row.push(field);
    field = "";
  }

  function endRow() {
    endField();
    rows.push({ rowNumber: rows.length + 1, cells: row });
    row = [];
  }

  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];

    if (inQuotes) {
      if (character !== "\"") {
        field += character;
      } else if (text[i + 1] === "\"") {
        field += "\"";
        i += 1;
      } else {
        inQuotes = false;
      }
    } else if (character === "\"" && field === "") {
      inQuotes = true;
    } else if (character === delimiter) {
      endField();
    } else if (character === "\r") {
      if (text[i + 1] === "\n") {
        i += 1;
      }
      endRow();
    } else if (character === "\n") {
      endRow();
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    throw new ImportFileError("The CSV file has a quote that is never closed");
  }
  if (field !== "" || row.length > 0) {
    endRow();
  }
  return rows;
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

function readZipDirectory(buffer) {
  let end = -1;
  const lowest = Math.max(0, buffer.length - 22 - 65535);

  for (let i = buffer.length - 22; i >= lowest; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) {
    throw new ImportFileError("The file is not a valid .xlsx workbook");
  }

  const entries = new Map();
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);

  for (let n = 0; n < count; n += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new ImportFileError("The file is not a valid .xlsx workbook");
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);

    entries.set(buffer.toString("utf8", offset + 46, offset + 46 + nameLength), {
      method: buffer.readUInt16LE(offset + 10),
      compressedSize: buffer.readUInt32LE(offset + 20),
      localOffset: buffer.readUInt32LE(offset + 42)
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(buffer, entry) {
  const at = entry.localOffset;

  if (buffer.readUInt32LE(at) !== 0x04034b50) {
    throw new ImportFileError("The file is not a valid .xlsx workbook");
  }
  const start = at + 30 + buffer.readUInt16LE(at + 26) + buffer.readUInt16LE(at + 28);
  const data = buffer.subarray(start, start + entry.compressedSize);

  if (entry.method === 0) {
    return data;
  }
  if (entry.method === 8) {
    return zlib.inflateRawSync(data, { maxOutputLength: MAX_UNZIPPED_BYTES });
  }
  throw new ImportFileError("The .xlsx workbook uses an unsupported compression method");
}

function decodeXml(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, name) => {
    const lower = name.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return "\"";
    if (lower === "apos") return "'";
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    return String.fromCodePoint(parseInt(lower.slice(1), 10));
  });
}

// Joins every <t> text piece (a cell can hold several rich-text runs)
function collectText(xml) {
  const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let text = "";

  for (const match of withoutPhonetic.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
    text += decodeXml(match[1]);
  }
  return text;
}

function readSharedStrings(xml) {
  const strings = [];

  for (const match of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    strings.push(match[1] === undefined ? "" : collectText(match[1]));
  }
  return strings;
}

function columnIndex(letters) {
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

function readCell(attributes, inner, sharedStrings) {
  const type = /(?:^|\s)t="(\w+)"/.exec(attributes);
  const kind = type ? type[1] : "n";

  if (kind === "inlineStr") {
    return collectText(inner);
  }

  const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
  if (!raw) {
    return "";
  }
  const value = decodeXml(raw[1]);

  if (kind === "s") return sharedStrings[Number(value)] ?? "";
  if (kind === "b") return value === "1" ? "TRUE" : "FALSE";
  if (kind === "e") return "";
  return value;
}

function firstSheetPath(entries, buffer) {
  const fallback = "xl/worksheets/sheet1.xml";

  try {
    const workbook = readZipEntry(buffer, entries.get("xl/workbook.xml")).toString("utf8");
    const sheet = /<sheet\b[^>]*>/.exec(workbook);
    const relationshipId = sheet && /\br:id="([^"]+)"/.exec(sheet[0]);
    const rels = readZipEntry(buffer, entries.get("xl/_rels/workbook.xml.rels")).toString("utf8");

    for (const tag of rels.match(/<Relationship\b[^>]*>/g) || []) {
      const id = /\bId="([^"]+)"/.exec(tag);
      const target = /\bTarget="([^"]+)"/.exec(tag);
      if (relationshipId && id && target && id[1] === relationshipId[1]) {
        return target[1].startsWith("/") ? target[1].slice(1) : `xl/${target[1]}`;
      }
    }
  } catch (error) {
    return fallback;
  }
  return fallback;
}

// Reads the first worksheet. Returns the same shape as parseCsv.
function parseXlsx(buffer) {
  try {
    const entries = readZipDirectory(buffer);
    const sheetPath = firstSheetPath(entries, buffer);

    if (!entries.has(sheetPath)) {
      throw new ImportFileError("The .xlsx workbook has no worksheet");
    }

    const sharedStrings = entries.has("xl/sharedStrings.xml")
      ? readSharedStrings(readZipEntry(buffer, entries.get("xl/sharedStrings.xml")).toString("utf8"))
      : [];
    const sheet = readZipEntry(buffer, entries.get(sheetPath)).toString("utf8");
    const rows = [];

    for (const rowMatch of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rowAttribute = /(?:^|\s)r="(\d+)"/.exec(rowMatch[1]);
      const cells = [];

      for (const cellMatch of (rowMatch[2] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const reference = /(?:^|\s)r="([A-Z]+)\d+"/.exec(cellMatch[1]);
        const position = reference ? columnIndex(reference[1]) : cells.length;

        while (cells.length < position) {
          cells.push("");
        }
        cells[position] = readCell(cellMatch[1], cellMatch[2] || "", sharedStrings);
      }
      rows.push({
        rowNumber: rowAttribute ? Number(rowAttribute[1]) : rows.length + 1,
        cells
      });
    }
    return rows;
  } catch (error) {
    if (error instanceof ImportFileError) {
      throw error;
    }
    throw new ImportFileError("The .xlsx file could not be read. Save it again as .xlsx or .csv");
  }
}

// ---------------------------------------------------------------------------
// Rows to question bodies
// ---------------------------------------------------------------------------

function parseSpreadsheet(file) {
  const name = (file.originalname || "").toLowerCase();

  if (name.endsWith(".csv")) {
    return parseCsv(file.buffer.toString("utf8"));
  }
  if (name.endsWith(".xlsx")) {
    if (file.buffer.length < 4 || file.buffer.toString("latin1", 0, 2) !== "PK") {
      throw new ImportFileError("The file is not a valid .xlsx workbook");
    }
    return parseXlsx(file.buffer);
  }
  throw new ImportFileError("Only .csv and .xlsx files can be imported");
}

function headerKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Works out which column holds which field. Unknown columns are ignored.
function buildColumnMap(headerCells) {
  const fields = {};
  const optionColumns = [];

  headerCells.forEach((cell, index) => {
    const key = headerKey(cell);

    if (OPTION_COLUMN.test(key)) {
      optionColumns.push(index);
      return;
    }
    Object.keys(COLUMN_ALIASES).forEach((field) => {
      if (fields[field] === undefined && COLUMN_ALIASES[field].includes(key)) {
        fields[field] = index;
      }
    });
  });

  return {
    fields,
    optionColumns,
    missing: REQUIRED_COLUMNS.filter((field) => fields[field] === undefined)
  };
}

function cellText(cells, index) {
  return index === undefined || cells[index] === undefined ? "" : String(cells[index]).trim();
}

// Builds the same kind of body the JSON create-question endpoint receives
function rowToBody(cells, map) {
  const body = {};

  Object.keys(map.fields).forEach((field) => {
    if (field !== "options") {
      body[field] = cellText(cells, map.fields[field]);
    }
  });

  let options = map.optionColumns.map((index) => cellText(cells, index)).filter(Boolean);
  if (options.length === 0 && map.fields.options !== undefined) {
    options = cellText(cells, map.fields.options)
      .split("|")
      .map((option) => option.trim())
      .filter(Boolean);
  }
  body.options = options;

  if (body.correctAnswer === "") {
    delete body.correctAnswer;
  }
  return body;
}

module.exports = {
  ImportFileError,
  REQUIRED_COLUMNS,
  parseCsv,
  parseXlsx,
  parseSpreadsheet,
  buildColumnMap,
  rowToBody
};