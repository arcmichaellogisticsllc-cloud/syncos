ALTER TABLE constraints ADD COLUMN client_mutation_id UUID;
CREATE UNIQUE INDEX constraint_request_key ON constraints(tenant_id,client_mutation_id) WHERE client_mutation_id IS NOT NULL;
ALTER TABLE relationship_paths ADD COLUMN client_mutation_id UUID;
CREATE UNIQUE INDEX relationship_path_request_key ON relationship_paths(tenant_id,client_mutation_id) WHERE client_mutation_id IS NOT NULL;
