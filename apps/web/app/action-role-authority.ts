// Additional role authority enforced by the API lifecycle controllers.
// Permission grants alone do not satisfy these operational approval boundaries.
export const actionRoleAuthority: Record<string, string[]> = {
  "qc_review.start": [
    "QC Manager",
    "Project Manager"
  ],
  "qc_review.approve": [
    "QC Manager",
    "Operations Manager"
  ],
  "qc_review.reject": [
    "QC Manager",
    "Project Manager"
  ],
  "qc_review.request_correction": [
    "QC Manager",
    "Project Manager",
    "Operations Manager"
  ],
  "qc_review.mark_corrected": [
    "QC Manager",
    "Project Manager"
  ],
  "production.request_correction": [
    "Project Manager",
    "Operations Manager"
  ],
  "qc.review": [
    "QC Manager",
    "Project Manager"
  ],
  "production.review": [
    "QC Manager",
    "Project Manager"
  ],
  "qc.accept": [
    "QC Manager"
  ],
  "qc.reject": [
    "QC Manager",
    "Project Manager"
  ],
  "qc.approve": [
    "QC Manager",
    "Operations Manager"
  ],
  "production.mark_billable": [
    "Billing Manager",
    "QC Manager"
  ],
  "production.clear_correction": [
    "QC Manager",
    "Project Manager"
  ],
  "production.mark_corrected": [
    "QC Manager",
    "Project Manager"
  ],
  "stop_work.issue": [
    "Safety Manager",
    "QC Manager",
    "Executive"
  ],
  "stop_work.release": [
    "Safety Manager",
    "Executive"
  ],
  "settlement.internal_review": [
    "Billing Manager",
    "Finance Manager"
  ],
  "settlement.ready_to_submit": [
    "Billing Manager"
  ],
  "settlement.submit": [
    "Billing Manager",
    "Finance Manager"
  ],
  "settlement.customer_review": [
    "Customer Validator",
    "Billing Manager",
    "Finance Manager"
  ],
  "settlement.approve": [
    "Customer Validator",
    "Billing Manager",
    "Finance Manager"
  ],
  "settlement.dispute": [
    "Customer Validator",
    "Billing Manager",
    "Finance Manager"
  ],
  "invoice.submit": ["Billing Manager", "Finance Manager"],
  "invoice.submit_review": ["Billing Manager", "Finance Manager"],
  "invoice.approve": [
    "Billing Manager",
    "Finance Manager"
  ],
  "invoice.mark_overdue": [
    "Billing Manager",
    "Finance Manager"
  ],
  "capacity_provider.activate": [
    "Operations Manager",
    "Compliance Manager"
  ],
  "capacity_provider.suspend": [
    "Operations Manager",
    "Compliance Manager",
    "Executive"
  ],
  "compliance_document.verify": [
    "Compliance Manager"
  ]
};
