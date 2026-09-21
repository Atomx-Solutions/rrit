-- RRIT-SA-02: global platform roles are separate from organization roles.
CREATE TABLE platform_user_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('superadmin', 'support')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role)
);

ALTER TABLE platform_user_roles ENABLE ROW LEVEL SECURITY;

-- The web runtime can only discover the signed-in user's own platform role.
-- It cannot assign, remove, or enumerate platform administrators.
GRANT SELECT ON platform_user_roles TO app_runtime;

CREATE POLICY platform_user_roles_runtime_self_read ON platform_user_roles
  FOR SELECT TO app_runtime
  USING (user_id = app.current_user_id());
