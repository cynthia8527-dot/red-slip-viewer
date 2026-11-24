# Heat / grind confirmation preview

## Existing product entry

Home → **紅單看片／校正** → select an image/PDF → **開始看片** → **預覽工法判讀**. The existing viewer handles local files and accounting Excel; its CSP blocks network connections. This candidate adds a confirmation/preview area there, not a separate application or an upload service. No authentication, database, accounting, price editing, CSV schema or shipment behavior changes.

Select **明寫／已確認工法** only after checking the original or confirmed evidence. That choice takes precedence. An item field consisting exactly of 熱處理／研磨／磁振／研亮／研加亮 is treated as written process; arbitrary item prose is not parsed into a confirmed process. Otherwise batch is a heat bias requiring review; barrel retains grinding/magnetic alternatives; insufficient or exceptional evidence remains pending. This is manual confirmation assistance, not OCR.

Results are rendered as text. Preview does not modify source fields, local calibration records, original charges, permanent quotes or closed records. Editing source fields, changing the image or applying accounting fields clears the prior confirmation and result. A preview is temporary and is not saved into the existing CSV/calibration record.

## Deliberate identity boundary

The viewer has customer text, accounting rows and file/sheet/row references. It does not load verified customer UUID mappings, price evidence or stable original-line identity. Repeated scans are not necessarily distinct original lines. Therefore the actual UI passes one current row without a fabricated identity or inferred pair; it cannot assert a high-rate/low-rate heat/grind split. Private quote prose is never embedded in public code or automatically activated as a permanent rule.

The standalone `classifyHeatGrind` public data boundary still supports review-only rate-pair annotations when a caller supplies verified customer identity and exactly two original kilogram rows with matching slip/weight, distinct positive rates and unambiguous provenance. It rejects code-only identity, conflicting customer references, duplicate sources, unknown price/unit, A/AA grades, magnetic work, grinding plus polishing, mixed work, ambiguous evidence and conflicting scoped references. Scoped person-confirmed private evidence requires an exact original scope. It returns unchanged source clones plus separate annotations and never calculates or writes a charge.

The module is self-contained; it does not import the unpublished private-price candidate or modify `data/pricing.js`. The branch starts at published main `fdaa3a76771a36fde3135704713522eddc32a8b4`. Only classification code, the existing viewer and necessary tests/docs are included; no private CLI or private customer mappings are part of this candidate.

## Validation boundary

`node --test tests/heat-grind-classification.test.mjs tests/heat-grind-preview-browser.test.mjs` covers 5 classification tests and 2 Chromium user-flow tests, all synthetic. Browser flows use the actual home link, image input, accounting workbook input and visible controls at 375px, while rejecting unexpected network requests and all mutations. Preview immutability, explicit/manual precedence, stale-result invalidation and unknown evidence are checked through these public boundaries. PDF rendering is stubbed because the tested flow uses a real image; the installed SheetJS distribution exercises local workbook input. No real iOS, live authenticated session, production data, remote CI or deployment is claimed. Full regression output is retained in the private handoff.

Verified full `npm test`: 152 passed, 0 failed, 0 skipped; main Supabase connections = 0. Related tests: 7 passed. Syntax and whitespace checks passed. These are local results, not remote CI or a release.
