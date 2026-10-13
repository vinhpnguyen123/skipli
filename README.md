# skipli

## Security notes

- **Ownership failures return 404, not 403.** When an employee requests a resource that belongs to someone else, the API answers exactly as if it didn't exist. A 403 would confirm the id is real, letting a caller enumerate other users' ids.
