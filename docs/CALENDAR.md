# Calendar, search, Quick Add and the clock

Rules live in `supabase/migrations/20261202000018_search_calendar.sql`; Google Calendar goes through
`api/calendar.ts` and the integrations system (`docs/INTEGRATIONS.md`).

## The top bar

- **Search** finds customers (by name, company, email or phone typed the local way, like
  082 441 9082), properties, meters (serial number), leads, sales orders (ORD-00042), invoices,
  support tickets (reference or subject), products (name or SKU), tasks (title or TSK-00012) and team
  members. Results are grouped, at most five of each kind.
  - It runs in the database as the signed-in person, so row security decides what can be found: a
    client only finds their own records, and nobody finds another business's. Results for pages the
    person's role cannot open (for example the Team page for staff) are left out.
  - Keyboard: `/` or Ctrl+K jumps to the search box from anywhere; arrows move, Enter opens, Esc
    closes. On phones, the search button opens it.
- **Quick Add** lists what the person may create: customer, property, meter, meter reading, lead,
  sales order, invoice, product, support ticket, task, calendar event and (administrators) employee.
  The list follows the same rules as the pages, so nobody is offered a page they cannot open. A client
  gets one button: Report a Problem.
- **The clock** shows the current South African time and date, changing on the minute.

## The calendar

**Calendar** in the menu (everyone except clients) shows, by month or as an agenda:

| On the calendar                                                | From                              | Opens           |
| -------------------------------------------------------------- | --------------------------------- | --------------- |
| Appointments (site visits, installations, meetings, reminders) | Made here                         | The event       |
| Tasks, on their due date                                       | Tasks not done or cancelled       | The task        |
| Maintenance, on its scheduled day                              | Scheduled, pending or in progress | The meter       |
| Invoices, on their due date                                    | Sent or part paid                 | The invoice     |
| Your Google Calendar events                                    | Google, live                      | Google Calendar |

Times are South African time (UTC+2 all year). Each source has its own colour, with its name always
shown too (the colour key, and on each item for screen readers).

**Appointments** have a title, type, date and times (or all day), who they are for (a team member),
an optional customer, place and notes. A property or ticket brings its customer; a customer that does
not match is refused. The organiser, the person it is for, and managers can change or delete one;
everyone on the team can see them.

## Google Calendar

Each person connects **their own** Google Calendar on the Calendar page (Connect Google Calendar):
Google asks them to allow Umbane to see and add calendar events. It is a personal connection: only
they (and administrators, to help) see it, and only they can disconnect it. Administrators see it
listed under Settings → Integrations → Calendars.

- **Their Google events** show beside Umbane's, read live from Google each time; they are never
  stored in Umbane.
- **Add to my Google Calendar** (on a new appointment, or from an existing one) puts a copy in their
  calendar. Changes to the appointment in Umbane update the copy; deleting it removes the copy too.
  The copy has a fixed id, so a retry never makes a second one. Changes made to the copy in Google do
  not come back into Umbane.
- If Google stops accepting the sign-in (revoked, password changed), the Calendar page says so and
  offers Reconnect.

**Setting it up (once, on the server):** it uses the same Google app as Gmail
(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL`; return address
`<APP_URL>/api/integrations/callback`). In Google Cloud Console:

1. APIs & Services → Library → **Google Calendar API** → Enable.
2. OAuth consent screen → Scopes → add `https://www.googleapis.com/auth/calendar.events`. It is a
   sensitive scope: Google must verify the app before people outside your Google Workspace can use it
   (until then, add them as test users).

## Limits

- The calendar loads about three months at most at a time (one month view, with the days around it).
- Up to 1,000 Google events are shown for a month.
- Only the primary Google Calendar is read and written.
- Two-way sync (Google changes flowing back into Umbane) is not built.
