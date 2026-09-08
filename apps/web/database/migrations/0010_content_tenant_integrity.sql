-- Bind every version, validation, approval and publication attempt to the same
-- tenant as its post. UUID uniqueness alone must not be the tenant boundary.
ALTER TABLE posts
  ADD CONSTRAINT posts_id_business_unique UNIQUE (id, business_id);

ALTER TABLE post_content_versions
  ADD CONSTRAINT post_content_versions_identity_unique
    UNIQUE (post_id, business_id, content_version),
  ADD CONSTRAINT post_content_versions_post_tenant_fk
    FOREIGN KEY (post_id, business_id)
    REFERENCES posts(id, business_id) ON DELETE CASCADE;

ALTER TABLE post_approval_records
  ADD CONSTRAINT post_approvals_content_tenant_fk
    FOREIGN KEY (post_id, business_id, content_version)
    REFERENCES post_content_versions(post_id, business_id, content_version) ON DELETE RESTRICT;

ALTER TABLE post_validations
  ADD CONSTRAINT post_validations_post_tenant_fk
    FOREIGN KEY (post_id, business_id)
    REFERENCES posts(id, business_id) ON DELETE CASCADE;

ALTER TABLE publication_jobs
  ADD CONSTRAINT publication_jobs_post_tenant_fk
    FOREIGN KEY (post_id, business_id)
    REFERENCES posts(id, business_id) ON DELETE CASCADE;
