# CSQP Project Documentation

Collaborative Study Material and Quiz Platform, Team 13, UE24CS341A Software Engineering.

## Requirements and design (IEEE format)

| Document | File |
|---|---|
| Software Requirements Specification | [design/Team13_SRS_Collaborative_Study_Material_and_Quiz_Platform.pdf](design/Team13_SRS_Collaborative_Study_Material_and_Quiz_Platform.pdf) |
| Software Architecture and Design | [design/Team13_SAD Collaborative Study Material and Quiz Platform.pdf](<design/Team13_SAD Collaborative Study Material and Quiz Platform.pdf>) |
| Software Test Plan | [design/Team13_Test_Plan_Collaborative_Study_Material_and_Quiz_Platform.pdf](design/Team13_Test_Plan_Collaborative_Study_Material_and_Quiz_Platform.pdf) |
| Deviations from SRS, SAD and Test Plan | [Deviations_from_SRS_and_SAD.md](Deviations_from_SRS_and_SAD.md) |

## Sprint outcome videos

| Sprint | Video |
|---|---|
| Sprint 1 (1 minute) | [videos/Sprint1_Demo.mov](videos/Sprint1_Demo.mov) |
| Sprint 2 (2 minutes) | [videos/Sprint2_Demo.mov](videos/Sprint2_Demo.mov) |

## Testing and quality assurance

| Report | File |
|---|---|
| Final Test Summary Report | [testing/Final_Test_Summary_Report.md](testing/Final_Test_Summary_Report.md) |
| Unit Test Report | [testing/Unit_Test_Report.md](testing/Unit_Test_Report.md) |
| System Validation Report (with traceability matrix) | [testing/System_Validation_Report.md](testing/System_Validation_Report.md) |
| Code Coverage Report | [testing/Code_Coverage_Report.md](testing/Code_Coverage_Report.md) |
| Branch Coverage Report | [testing/Branch_Coverage_Report.md](testing/Branch_Coverage_Report.md) |
| Updated Test Cases | [testing/Updated_Test_Cases.md](testing/Updated_Test_Cases.md) |
| Sprint 1 Test Execution Summary | [testing/Sprint1_Test_Execution_Summary.md](testing/Sprint1_Test_Execution_Summary.md) |
| Responsive and accessibility checklist (NF-004) | [testing/responsive-accessibility-checklist.md](testing/responsive-accessibility-checklist.md) |
| Raw test runner output | [testing/raw/](testing/raw/) |

To regenerate every test report from a fresh run, from the repository root:

```sh
node docs/testing/generate-reports.mjs
```

## Feature notes

- [CSQP-F-014.md](CSQP-F-014.md), [CSQP-F-050.md](CSQP-F-050.md), [CSQP-F-052.md](CSQP-F-052.md)
- [question-import.md](question-import.md) and [templates/question-import-template.csv](templates/question-import-template.csv)

## Agile process

Backlog, story points, assignees and Sprint 1 / Sprint 2 planning are on the GitHub Project linked to this repository. Each backlog item was developed on its own `CSQP-F-xxx` branch and merged to `main` through a reviewed pull request, with CI (`.github/workflows/ci.yml`) running on every pull request.
