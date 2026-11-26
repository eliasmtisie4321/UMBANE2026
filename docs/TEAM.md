# Team and tasks: rules and assumptions

The rules live in the database (`supabase/migrations/20261126000011_team_tasks.sql`).

## Who does what

| Action                                   | Staff                   | Manager       | Administrator       |
| ---------------------------------------- | ----------------------- | ------------- | ------------------- |
| See the Team page and employee profiles  | No                      | Yes           | Yes                 |
| Add employees, change employment details | No                      | No            | Yes                 |
| Deactivate or reactivate someone         | No                      | No            | Yes, not themselves |
| Change their own name and phone          | Yes                     | Yes           | Yes                 |
| Create, edit, assign and cancel tasks    | No                      | Yes           | Yes                 |
| See tasks                                | Only their own          | All           | All                 |
| Start, pause and complete a task         | Their own               | Yes           | Yes                 |
| Post progress updates and photos         | On their own open tasks | Yes           | Yes                 |
| Reopen a completed or cancelled task     | No                      | Yes           | Yes                 |
| Delete a task, update or file            | No                      | Yes (audited) | Yes (audited)       |

Clients see nothing from the team or tasks.

## Employees

- Each team member has an employee number (`EMP-001`, …), given in the order they joined. It never
  changes.
- Department, job title, status (Active, On Leave, Training), start date and manager are set by an
  administrator. People can change their own name and phone number.
- **Deactivating** someone removes all their access at once and keeps their history. Nobody can
  deactivate themselves or change their own access level, so a business can never lock itself out.

## Adding someone to the team

The app has no server key, so it cannot create sign-in accounts itself. Instead:

1. An administrator chooses **Team → Add Employee** and enters their details and access level.
2. If that email already has a confirmed account (and no profile), they are added at once.
3. Otherwise the details are saved as an **invitation**. The administrator then opens Supabase →
   **Authentication → Users → Add user → Send invitation** for the same email.
4. When the person accepts the email and sets a password, the database creates their profile with the
   saved details. Until then they appear under **Waiting to join**, where the invitation can be
   cancelled.

- An email can only have one open invitation, across all businesses, so an account joins exactly one.
- Only a **confirmed** email gets a profile. Someone signing up with an invited address but never
  confirming it gets nothing.
- If the profile cannot be created when they accept (rare), their sign-in still works and the invitation
  stays waiting.

## Tasks

- References look like `TSK-00042`.
- Statuses: **Pending → In Progress → Completed**, or **Cancelled**. A task past its due date that is
  still open shows as **Overdue**.
- A task can start Pending or In Progress. In Progress and Completed need an assignee; unassigning a
  task in progress returns it to Pending.
- **Completing** records when and by whom. Cancelling needs a reason. Completed and cancelled tasks are
  locked until a manager reopens them.
- **Proof of work:** a task can require a photo. It cannot be completed until at least one photo (JPG,
  PNG or WebP) is attached; a PDF does not count.
- Links: a task can be linked to a customer, property and support ticket. Choosing a ticket or property
  fills in the customer, and all three must belong to the same customer.
- The assignee only moves their task along. They cannot change its title, dates, priority, links or
  assignee, and cannot cancel or reopen it.
- Start, completion and activity times are set by the database.

## Progress updates, files and history

- Progress updates are written by the person signed in and cannot be edited.
- Proof-of-work files (photos or PDF, up to 10 MB each, 20 per task) live in the private
  `task-attachments` storage bucket. Only managers and the assignee can open them, through links that
  expire after an hour. No more files or updates are added once a task is completed or cancelled.
- The history records creation, each status, assignment, priority and due date change, and each file.

## Notifications

| Event               | Who is told                  |
| ------------------- | ---------------------------- |
| A task is assigned  | The assignee                 |
| A progress update   | The creator and the assignee |
| A task is completed | The creator                  |
| A task is cancelled | The assignee                 |

Nobody is notified about their own action.

## Workload figures

- **Open tasks:** Pending or In Progress. **Overdue:** open and past the due date (South African date).
- **Finished on time:** of the completed tasks that had a due date, how many were completed on or before
  it.

## Not built

- Profile photos, home addresses, leave calendars and shift rosters.
- Department leads and capacity targets.
- Scheduled visit times (tasks have dates, not times), recurring tasks and checklists.
- Email or SMS notifications.
