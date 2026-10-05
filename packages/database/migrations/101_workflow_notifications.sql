CREATE TABLE workflow_notifications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), task_id UUID NOT NULL REFERENCES workflow_tasks(id), recipient_user_id UUID NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('assigned','overdue','escalated')), dedupe_key TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0), next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(), sent_at TIMESTAMPTZ, last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE workflow_notification_attempts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), notification_id UUID NOT NULL REFERENCES workflow_notifications(id),
 status TEXT NOT NULL CHECK(status IN ('sent','failed','cancelled','retry_requested')), actor_user_id UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workflow_notifications_ready_idx ON workflow_notifications(next_attempt_at,created_at) WHERE status='pending';
CREATE INDEX workflow_notifications_recipient_idx ON workflow_notifications(tenant_id,recipient_user_id,created_at DESC,id DESC);
CREATE INDEX workflow_tasks_open_due_idx ON workflow_tasks(tenant_id,due_at) WHERE deleted_at IS NULL AND status IN ('open','in_progress','reassigned','escalated');
-- No invented escalation recipient: use the task's explicit assignment and recorded escalation.
CREATE VIEW workflow_notice_candidates AS
WITH recipients AS (
 SELECT wt.id task_id,wt.tenant_id,tu.user_id recipient_user_id,wt.due_at,wt.assigned_to,wt.assigned_user_id,wt.assigned_role,wt.assigned_role_id,wt.reassigned_at,wt.created_at,
 CASE WHEN wt.status='escalated' THEN e.id ELSE NULL END escalation_id,
 CASE WHEN wt.status='escalated' THEN e.escalated_to_role ELSE NULL END escalation_role,
 CASE WHEN wt.status='escalated' THEN e.escalated_to_role_id ELSE NULL END escalation_role_id
 FROM workflow_tasks wt JOIN tenants t ON t.id=wt.tenant_id AND t.status='active' AND t.deleted_at IS NULL
 JOIN tenant_users tu ON tu.tenant_id=wt.tenant_id AND tu.status='active' AND tu.deleted_at IS NULL
 JOIN users u ON u.id=tu.user_id AND u.status='active' AND u.deleted_at IS NULL
 LEFT JOIN LATERAL (SELECT id,escalated_to_role,escalated_to_role_id FROM workflow_escalations WHERE tenant_id=wt.tenant_id AND workflow_task_id=wt.id AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 1) e ON true
 WHERE wt.deleted_at IS NULL AND wt.status IN ('open','in_progress','reassigned','escalated')
 AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.tenant_id=ur.tenant_id AND r.id=ur.role_id AND r.deleted_at IS NULL JOIN role_permissions rp ON rp.tenant_id=r.tenant_id AND rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE ur.tenant_id=tu.tenant_id AND ur.tenant_user_id=tu.id AND ur.scope_type='tenant' AND p.key='workflow_task.read')
), matched AS (
 SELECT rec.*,
 (COALESCE(assigned_user_id,assigned_to)=recipient_user_id OR (COALESCE(assigned_user_id,assigned_to) IS NULL AND EXISTS(
   SELECT 1 FROM tenant_users tu JOIN user_roles ur ON ur.tenant_id=tu.tenant_id AND ur.tenant_user_id=tu.id JOIN roles r ON r.id=ur.role_id AND r.tenant_id=ur.tenant_id AND r.deleted_at IS NULL
   WHERE tu.tenant_id=rec.tenant_id AND tu.user_id=rec.recipient_user_id AND ur.scope_type='tenant' AND (r.id=rec.assigned_role_id OR (rec.assigned_role_id IS NULL AND r.name=rec.assigned_role))
 ))) AS assigned_match,
 (escalation_id IS NOT NULL AND EXISTS(
   SELECT 1 FROM tenant_users tu JOIN user_roles ur ON ur.tenant_id=tu.tenant_id AND ur.tenant_user_id=tu.id JOIN roles r ON r.id=ur.role_id AND r.tenant_id=ur.tenant_id AND r.deleted_at IS NULL
   WHERE tu.tenant_id=rec.tenant_id AND tu.user_id=rec.recipient_user_id AND ur.scope_type='tenant' AND (r.id=rec.escalation_role_id OR (rec.escalation_role_id IS NULL AND r.name=rec.escalation_role))
 )) AS escalation_match
 FROM recipients rec
), eligible AS (
 SELECT m.*,kind FROM matched m CROSS JOIN (VALUES('assigned'),('overdue'),('escalated')) kinds(kind)
 WHERE (assigned_match AND (kind='assigned' OR (kind='overdue' AND due_at<=now()))) OR (escalation_match AND kind='escalated')
)
SELECT task_id,tenant_id,recipient_user_id,kind,created_at,
 task_id::text||':'||recipient_user_id::text||':'||kind||':'||md5(concat_ws('|',assigned_to,assigned_user_id,assigned_role,assigned_role_id,reassigned_at,CASE WHEN kind='overdue' THEN due_at END,CASE WHEN kind='escalated' THEN escalation_id END)) AS dedupe_key
FROM eligible;
