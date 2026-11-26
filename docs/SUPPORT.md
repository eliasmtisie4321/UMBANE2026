# Support tickets: rules and assumptions

The rules live in the database (`supabase/migrations/20261126000010_support_tickets.sql`).

## Who does what

| Action                              | Client (own tickets) | Staff                 | Manager, administrator      |
| ----------------------------------- | -------------------- | --------------------- | --------------------------- |
| Open a ticket                       | Yes, for themselves  | Yes, for any customer | Yes                         |
| Choose priority and assignee        | No                   | Yes                   | Yes                         |
| Reply                               | Yes                  | Yes                   | Yes                         |
| Write and read internal notes       | No, never sees them  | Yes                   | Yes                         |
| Attach photos and documents         | Yes                  | Yes                   | Yes                         |
| Assign, change status, edit details | No                   | Yes                   | Yes                         |
| Remove a ticket, message or file    | No                   | No                    | Yes (kept in the audit log) |

## Opening a ticket

- Each ticket gets a reference such as `TKT-2026-00042`, numbered per business per year.
- A client's ticket is always their own. It starts **Open**, at **Normal** priority and unassigned,
  whatever the browser sends: the team decides priority and who works on it.
- The property and meter, if chosen, must be the customer's. Choosing a meter fills in its property.
- A title (up to 150 characters), a category and a description are required.

## Statuses

Open → Assigned → In Progress → Resolved → Closed.

- **Assigning** an open ticket moves it to Assigned. **Unassigning** an assigned or in-progress ticket
  returns it to Open.
- Assigned and In Progress need an assignee. Only a current team member can be assigned.
- **Resolved** and **Closed** need a resolution note, which the customer can see. A ticket can be closed
  without being resolved first (a duplicate, for example), with the reason as the note.
- **A customer reply reopens a resolved ticket**: it goes back to In Progress (or Open if nobody is
  assigned).
- **Closed is final.** Nobody can reply, attach files or change it. The customer opens a new ticket.
- The database records when the ticket was assigned, first answered, resolved and closed. These cannot
  be set by hand.

## Conversation

- Replies are seen by the customer. **Internal notes** are only for the team; the database never returns
  them to a client.
- A message is always from the person signed in, with their name kept on it, so clients see who replied
  without being able to read staff profiles.
- Messages cannot be edited. A manager can remove one; the removal is in the audit log.

## History

- Every status change, assignment and priority change is recorded with who made it and when.
- Clients see when the ticket was opened, its status changes and files added, but not assignment or
  priority changes.

## Attachments

- Photos (JPG, PNG, WebP), PDF, CSV and text files, up to 10 MB each and 20 per ticket.
- Files are kept in a **private** storage bucket (`ticket-attachments`) under
  `<business>/<ticket>/<file>`. A file can only be read by people who can see its ticket, through links
  that expire after an hour.
- The bucket refuses other types and larger files. The database checks again, using the type and size
  the storage service recorded rather than what the browser claimed.
- Attachments are visible to the customer. Do not attach internal documents.
- If a file uploads but cannot be recorded (rare), it stays in storage unseen. Nobody can open it from
  the app.

## Notifications

In-app notifications (the bell in the top bar, and the Notifications page):

| Event                                  | Who is told                                     |
| -------------------------------------- | ----------------------------------------------- |
| A ticket is opened, unassigned         | Managers and administrators                     |
| A ticket is assigned                   | The assignee                                    |
| A team member opens one for a customer | The customer, if they have a sign-in            |
| A status changes                       | The customer                                    |
| A team reply                           | The customer, and the assignee                  |
| A customer reply                       | The assignee, or managers if nobody is assigned |
| An internal note                       | The assignee                                    |

Nobody is notified about their own action, and deactivated users are skipped. Email and SMS are not sent
yet (see Phase 10 and Phase 12).

## Not built

- Response and resolution time targets (SLAs) and escalation.
- Scheduling a site visit from the ticket (Phase 9 tasks will cover field work).
- Email or SMS notifications, and opening tickets by email.
- Customer satisfaction ratings, merging duplicate tickets, and reopening a closed ticket.
- Removing an attachment from the app (a manager can do it in the database).
