# Bulk question import (CSQP-F-032)

Instructors and admins can add many questions at once from a CSV or Excel file.

`POST /api/questions/import` with a `multipart/form-data` body and one file in the field `file`.
A ready-to-use example is in `docs/templates/question-import-template.csv`.

## File rules

- File type: `.csv` or `.xlsx` (the first worksheet is read). Old `.xls` files must be saved as `.xlsx`.
- Size: at most 1 MB and 500 questions per file.
- CSV files may use commas, semicolons or tabs, and may contain quoted text with line breaks.
- The first non-empty row is the header. Column names are not case sensitive.

| Column | Required | Notes |
|---|---|---|
| `text` (or `question`) | yes | Up to 2000 characters |
| `type` | yes | `mcq`, `true_false` or `short_answer` |
| `subject` | yes | Up to 100 characters |
| `topic` | yes | Up to 100 characters |
| `difficulty` (or `level`) | yes | `easy`, `medium` or `hard` |
| `option1` ... `option6` (or `optionA` ... `optionF`) | MCQ only | 2 to 6 distinct options. Alternatively one `options` column with the options separated by `\|` |
| `correctAnswer` (or `answer`) | MCQ and true/false | MCQ: the option text, or its letter (`B`) or number (`2`). True/false: `true` or `false`. Optional model answer for `short_answer` |

Other columns are ignored. Blank rows are skipped.

## Result

Valid rows are saved. Invalid rows never block the valid ones; each is reported with its row number
(the row number in the spreadsheet, the header being row 1) and the reason.

A row is rejected when it breaks the same rules as the single-question endpoint, when it repeats an
earlier row of the same file (same subject, topic and text), or when the question already exists in the bank.

```json
{
  "status": "success",
  "message": "Imported 2 of 3 questions",
  "summary": { "totalRows": 3, "imported": 2, "failed": 1 },
  "errors": [ { "row": 3, "errors": { "difficulty": "Difficulty must be easy, medium, or hard" } } ],
  "questions": [ { "...": "saved questions" } ]
}
```

| Status | When |
|---|---|
| 201 | At least one question was imported |
| 400 | No file, wrong file type, file too big, empty file, missing required columns, more than 500 rows, or no valid row |
| 401 / 403 | Not signed in / not an instructor or admin |