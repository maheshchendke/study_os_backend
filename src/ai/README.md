The AI service is implemented in `../services/ai.js` and uses an OpenAI-compatible
Chat Completions endpoint configured exclusively by backend environment variables.
It receives sanitized, user-scoped records and can only execute an allow-listed
structured action through backend services. It never receives a database handle or
SQL statements.
