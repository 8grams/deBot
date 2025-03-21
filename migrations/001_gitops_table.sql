CREATE TABLE gitops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) UNIQUE,
    argocd_server_url VARCHAR(255) UNIQUE,
    argocd_token VARCHAR(255),
    csp_url VARCHAR(255),
    created_time INT
);