-- The plugin source of the connector catalog (spec section 9), filled by the scheduled indexer.
CREATE TABLE plugin_catalog (
  id TEXT PRIMARY KEY,
  marketplace TEXT NOT NULL,
  entry TEXT NOT NULL,
  servers TEXT NOT NULL,
  skills TEXT NOT NULL,
  inert TEXT NOT NULL,
  indexed_at INTEGER NOT NULL
);
CREATE INDEX plugin_catalog_marketplace ON plugin_catalog (marketplace);
