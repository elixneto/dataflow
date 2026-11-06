-- What a script exports now says which names are functions (a Script Invoker lists them). The list reads it again for
-- each script whose `exports` is null, once, and keeps it.
ALTER TABLE scripts ALTER COLUMN exports DROP NOT NULL;
UPDATE scripts SET exports = NULL;
