# Production quantity candidate

Local candidate only. Priority automation remains disabled, staging has not been changed, and shared demo/operational data has not been reseeded or reset.

## Implemented controls

- Stable work-item registration prevents a second record from claiming the same reviewed work reference within a work order. Reviewed repeated assets/routes require reference classification or separately authorized additional work.
- Immutable quantity-review history distinguishes primary work, additional work, included subsets and summaries. A subset references one same-unit work item and cannot exceed it. A summary references distinct same-unit work items and must equal their total.
- Submitted corrections contribute to the effective reviewed source without changing the original submitted record. Date, quantity, location, code and correction revisions invalidate older reviews. Parent-source changes invalidate dependent reference reviews.
- Customer acceptance and production-linked financial advancement require a current primary/additional-work review. Subsets and summaries cannot become separate billable production. Acceptance cannot exceed the effective reviewed quantity.
- Existing financial use blocks reclassification until controlled adjustments are handled. Original records and prior reviews remain retained.
- Staff choose underlying work by business reference, asset or route. Crew responses contain classification information but exclude internal commercial source references and reconciliation notes.

## Verification

The candidate passed a full 206-check unit run before the final privacy and dependency-review additions. The final focused quantity/finance suite passed 21 checks, including those additions. All migrations through 075 applied to a fresh disposable database; the disposable acceptance database also upgraded successfully.

The final combined browser/API run passed all 29 checks across internal workforce, daily production and customer QC. Both workforce types reached accepted billing and the existing finance path. The new reconciliation scenario verified subset/summary exclusion, stable-identity rejection, reviewer access, source preservation, candidate lookup and field privacy. The evidence scenario exercised quantity review through the browser. Intermediate runs exposed duplicate synthetic independent-work fixtures, nondeterministic account-switch setup and an incorrect rejection-message expectation; those runs are not acceptance evidence.

## Remaining limits

This is explicit source reconciliation, not automatic geometric overlap detection. Reviewers must verify stable work identities and actual additional-work approvals. Raw unreviewed entries remain provisional. Older administrative rollups and all reporting surfaces still require reconciliation against this model before broad release certification. This candidate does not establish approved premium rates, contract terms, prime correction deadlines or invoice-package acceptance.

Physical-phone acceptance, current governing contract/rate documents and staging revalidation remain required. The complete seven-priority release is not yet certified.
