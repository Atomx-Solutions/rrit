-- The monthly planner checks payment status while advancing jobs. The worker
-- role needs the same narrowly scoped function access as the runtime role.
GRANT EXECUTE ON FUNCTION app.organization_payment_overdue(uuid) TO rrit_worker;
