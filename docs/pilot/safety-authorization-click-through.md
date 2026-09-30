# Safety authorization: supervised walkthrough

Use isolated pilot records and distinct test identities. Do not treat a saved form as real external approval.

1. Management opens **Field map setup → Safety scope reviews and work authorization**. Expand the relevant work-order version. Review its governing safety requirements, record the source, select pre-bore approval when applicable, and save.
2. The foreman records attendance and completes the Daily JSA for the actual work location. Foreman certification does not acknowledge for crew members.
3. Each present worker signs in using their own linked account, opens **Safety reviews and work authorization**, reads the current location, hazards and controls, selects the personal confirmation, and chooses **Acknowledge my safety review**.
4. Where required, the foreman expands **Request a pre-bore inspection**, identifies the inspection scope and supporting utility/evidence references, and chooses **Request supervisor review**.
5. The authorized internal reviewer verifies the actual construction-supervisor approval and records that person's name, time and evidence reference. The foreman cannot approve this request.
6. A Safety Manager, QC Manager or authorized executive can place the work order or selected crew on hold. A location entry currently holds that crew's entire work order. Test an offline queued production submission: it must remain blocked when replayed.
7. For an imported shutdown, Safety first reviews its source and records whether a utility strike occurred. A missing historical classification is not assumed to be clearance.
8. For a utility strike, record verified utility-owner clearance first. Safety approval follows. Operations approval is last. For other shutdowns, Safety precedes Operations. Each step requires actual evidence; repeated identical approval requests do not duplicate approval records.
9. The foreman revises the JSA for restart. Each present worker acknowledges the new revision. Obtain a new pre-bore approval where required. Releasing a shutdown alone must not enable work against the prior JSA.
10. Resume work only after all applicable requirements pass. Confirm the audit history retains the original stop, each approval, prior JSA and worker acknowledgments.

Physical acceptance must repeat these steps on supported real phones, including loss of connectivity, app suspension and device restart. Record device, browser version, actor, timestamps and results. That evidence has not yet been collected.
