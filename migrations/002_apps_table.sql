CREATE TABLE apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) UNIQUE,
    app_group_name VARCHAR(255),
    app_group_id VARCHAR(255),
    pipeline_token VARCHAR(255) UNIQUE,
    csp_folder VARCHAR(255),
    gitops_id INTEGER REFERENCES gitops(id),
    created_time INT
);