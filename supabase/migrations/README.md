# Migrations

Version-controlled SQL migrations, applied in filename order. Name files
`YYYYMMDDHHMMSS_short_description.sql`. Every table must enable Row Level Security
in the same migration that creates it. Phase 1 adds the first schema.
