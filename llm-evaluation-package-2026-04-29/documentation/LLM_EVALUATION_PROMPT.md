# LLM Evaluation Prompt

You are evaluating whether a software system matches an operations-control requirements document.

Inputs provided:
1. The requirements/documentation source supplied by the user.
2. This evidence package containing screenshots, a system summary, an alignment matrix, and API summary data.

Task:
- Compare the requirements document against the screenshots and documentation in this package.
- Identify where the system clearly satisfies the document.
- Identify where the system partially satisfies the document.
- Identify missing or ambiguous requirements.
- Distinguish between visible UI evidence, API/data evidence, and inferred architecture.
- Do not assume production readiness just because a concept is represented in the UI.

Recommended output:
1. Executive alignment score from 0-100.
2. Section-by-section alignment table.
3. Strongest evidence of system depth.
4. Gaps or weak evidence.
5. Suggestions for screenshots, docs, or implementation changes that would make alignment clearer.

Use `documentation/SCREENSHOT_INDEX.md` to understand what each image is intended to prove. Use `documentation/ALIGN_ALIGNMENT_MATRIX.md` as a starting hypothesis, but verify it against the supplied requirements document.
