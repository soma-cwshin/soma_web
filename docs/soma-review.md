# Local SoMa library reviews

`POST /api/soma-review` connects the standalone library HTML to the MAPS Supabase already configured on this deployment with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The client contains neither key. It sends only expert review fields, never member assessment values.

Modern keys can instead be provided as `SUPABASE_SECRET_KEY`; they are sent only in the `apikey` header. Legacy JWT service-role keys also use the Authorization header. The URL and key are trimmed before use. Authentication failures report only an upstream status/code, key type and public project hostname, never the key itself.

The review UI has no code entry, login, reviewer name or priority field. The privately distributed local library supplies its existing review-only credential automatically from a local `review/review-access.js` file. That file must stay outside this repository and is distributed only with the review bundle; it contains no Supabase or MAPS administrator key. The API still requires and validates the review credential using `SOMA_REVIEW_CODE_SHA256` (or the provisioned digest). Requests are restricted to the canonical review catalog and never grant arbitrary MAPS table access. Origin `null` supports a local HTML file; permitted web origins are explicitly listed. No cross-origin cookies are enabled.

## Storage

Reviews are independent, immutable rows in the existing `maps_sales_sync` document store. Row IDs are `soma-review-v1:<library>:<cardId>:<requestUuid>`. The `visit_state` JSON contains the review schema, canonical card identity, content digest, area, stage, proposal and server timestamp. New records do not contain a reviewer name or priority. Historic rows are retained, but their names and priorities are omitted from responses. `default`, its map data and its update timestamp are never changed by a review. No database migration is needed.

The canonical item catalog contains all 833 library cards. Shared IDs across the base and Pilates libraries remain distinguishable by library. The content digest ties feedback to the exact reviewed card version. Each submission receives a server timestamp; client timestamps and removed form fields are ignored.

Use the Supabase table editor to filter `id` starting with `soma-review-v1:`. For a SQL report:

```sql
select id, visit_state->>'library' as library,
       visit_state->>'cardId' as card_id,
       visit_state->>'cardName' as card_name,
       visit_state->>'area' as area,
       visit_state->>'stage' as stage,
       visit_state->>'proposal' as proposal,
       updated_at
from public.maps_sales_sync
where id like 'soma-review-v1:%'
order by updated_at desc;
```

## API and validation

Normal POST requests send JSON and the bundle's review-only Bearer credential automatically; reviewers do not enter a code.

- `action: session` checks MAPS connectivity.
- `action: list`, `library`, `cardId`, optional `before: {id,at}` returns 50 reviews plus a cursor, newest first.
- `action: submit` accepts `requestId` (UUID v4), `library`, `cardId`, `contentHash`, `area`, `stage`, `proposal`. A repeated UUID is idempotent. Different content under the same UUID is rejected. Successful submission is read back before acknowledgment.
- `action: session, verifyWrite: true` requires the private maintenance code as a Bearer credential. It checks persistence with one temporary `soma-review-check-v1:<uuid>` row and deletes only that exact row. This action is not part of the review UI.

The browser distinguishes drafts from server-confirmed saves. Failed requests preserve the draft and its UUID; late responses cannot erase a draft for a different card. HTML rendering uses text nodes for returned review content.

There is no public arbitrary table access, review deletion, role modification or map-state mutation in this endpoint. The existing MAPS service's deployment environment and table access controls are retained.
