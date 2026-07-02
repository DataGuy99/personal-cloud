// REVIEW TIER — currently empty by design.
//
// pdf_javascript was removed 2026-07: it flagged EVERY PDF containing /JS or
// /JavaScript, which includes most textbooks, forms, and OCR'd documents.
// A multi-thousand-book library would be carpet-flagged. That is detection
// theater, not detection.
//
// Malware detection philosophy (see docs/DECISIONS.md):
//   - ClamAV is the primary detector. It has dedicated parsers for PDF, OLE,
//     archives, images, and media, plus a signature DB updated daily by
//     freshclam. It flags files that ARE malicious, not files that COULD be.
//   - YARA block-tier (stego.yar) covers narrow high-confidence attack
//     patterns ClamAV may miss (polyglots, appended executables).
//   - Add review-tier rules here ONLY for patterns with a low false-positive
//     rate that genuinely warrant a human look.
