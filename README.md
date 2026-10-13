# skipli

## Security notes

- **Ownership failures return 404, not 403.** When an employee requests a resource that belongs to someone else, the API answers exactly as if it didn't exist. A 403 would confirm the id is real, letting a caller enumerate other users' ids.
- **Deleting an employee is a hard delete.** The user record, their email/phone reservations, refresh tokens, pending invite links and login codes are removed in one transaction, and their open sockets are disconnected. Every request re-checks that the account still exists, so an access token they still hold stops working right away instead of at its 15-minute expiry. Activity entries keep a copy of the employee's name, so the history still reads correctly after they're gone. The schema also has `status: 'disabled'`, the reversible option: it blocks sign-in and API access but keeps the record. It isn't exposed in the UI yet.
