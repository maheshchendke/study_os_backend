USE studyos;

INSERT INTO users (id, name, role)
VALUES ('00000000-0000-4000-8000-000000000001', 'Student', 'student')
ON DUPLICATE KEY UPDATE name = VALUES(name);
