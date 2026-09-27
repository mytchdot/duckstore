# Duck Store Platform

A TypeScript take-home: a React Warehouse UI, an Express API, and MySQL inventory. The Store module is backend-only: its order endpoint returns packaging and an itemized USD total. There is no ORM, authentication, checkout screen, or order persistence.

## Author Note

With this project, there was a large decision to make: Architect it like it was a real project that will grow over the years, or, architech it for what the spec called for, without overengineering or expecting growth over years. I chose the latter, as I wanted to focus on the spec and the code as it was given. I add this preface to explain my decision and the choices I made, and how I would have possibly done it differently given it was a real project that will grow over the years.

## Run locally

Prerequisites: Node.js **22.12+** (tested on Node 24), npm, and **MySQL 8.0.16+** (tested on MySQL 8.4).

```sh
npm ci
cp .env.example .env
```

Then choose a database:

- **Docker (optional):** `docker compose up -d --wait` starts only MySQL on `127.0.0.1:3307`, creates the `duckstore` database, and keeps data in a volume. `.env.example` already points at it with local demo credentials.
- **Existing MySQL:** create a database and a user, then set `DATABASE_URL` in `.env`. MySQL must use InnoDB and enforce CHECK constraints.

```sh
npm run db:setup  # creates the table; safe to repeat, preserves inventory
npm run db:seed   # optional mockup data
npm run dev
```

Open **<http://localhost:5173>**. Vite proxies `/api` to Express on `127.0.0.1:3001` (set `PORT` to change it). Setup and startup wait up to about 30 seconds for MySQL, and startup stops with an error if the schema is missing or the port is already in use.

`db:seed` inserts each demo duck that has no active color/size/price match; it never changes existing quantities. On a fresh database its IDs match the mockup. IDs can have gaps after merges, which is normal for MySQL auto-increment.

For a production build served by Express at **<http://localhost:3001>**:

```sh
npm run build
npm start
```

The server binds to localhost only, because the app has no authentication.

## Verify

```sh
npm test             # server unit tests and client edit/request regression tests
npm run lint         # Biome lint, import order, and formatting check
npm run format       # apply formatting
npm run build        # type check client and server, then build both
```

The unit tests above use Node's built-in test runner (`server/src/*.test.ts` and `client/tests/*.test.ts`) and need no database. Client tests mock fetch to exercise partial edits and request errors. Formatting and lint settings live in `biome.jsonc`.

### API and browser tests

These suites use real MySQL and **erase their test database's ducks table**. Use a dedicated database whose name ends in `_test`; the helpers reject other names. Run the suites one after the other because they reset the same table.

With the supplied Docker Compose database, create the test database and grant the demo user access (safe to repeat):

```sh
docker compose up -d --wait
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot' <<'SQL'
CREATE DATABASE IF NOT EXISTS duckstore_test;
GRANT ALL PRIVILEGES ON duckstore_test.* TO 'duckstore'@'%';
SQL
```

The default test connection is `mysql://duckstore:duckstore@127.0.0.1:3307/duckstore_test`. For an existing MySQL installation, create a dedicated test database and grant your test user access, then set `TEST_DATABASE_URL` in `.env` or your shell. For example:

```sh
export TEST_DATABASE_URL='mysql://test_user:password@127.0.0.1:3306/duckstore_test'
```

Use the default connection for Docker; the override above is only for your own MySQL setup. The suites create the table themselves and do not use `DATABASE_URL` for their inventory.

```sh
npm run test:api
npx playwright install chromium  # once per machine; on Linux, use: npx playwright install --with-deps chromium
npm run test:e2e
```

The API suite checks CRUD, pricing, validation, concurrency, and database scripts. The browser suite builds the app and starts its own development and production servers; ports `3297`, `5297`, and `3298` must be free. It checks forms, failures, keyboard focus, and mobile layout in Chromium. You do not need to run `npm run dev` separately. Browser failure traces are saved under `duckstore-e2e` in your system's temporary directory.

## API

Request bodies are UTF-8 JSON sent with `Content-Type: application/json`, and are validated strictly: unknown fields are rejected and enum values are case-sensitive. Money **inputs accept JSON numbers or decimal strings** (`10`, `10.5`, `"10.50"`, `".5"`), with at most two decimal places. Numeric inputs are normalized to strings before validation; extra decimal places are rejected, not rounded. Money **responses are two-decimal strings** (`"10.00"`). Quantities and IDs are JSON integers.

| Method and path         | Behavior                                                                 |
| ----------------------- | ------------------------------------------------------------------------ |
| `GET /api/ducks`        | Active ducks, quantity descending, then ID ascending                     |
| `POST /api/ducks`       | Create (`201`) or add to an active match (`200`); returns the duck       |
| `PATCH /api/ducks/:id`  | Update price and/or absolute quantity; returns the duck (`200`)          |
| `DELETE /api/ducks/:id` | Soft-delete (`204`); repeating it is harmless                            |
| `POST /api/orders`      | Calculate packaging and the order total (`200`); never changes inventory |
| `GET /api/health`       | Check database connectivity (`200`)                                      |

Colors: `Red`, `Green`, `Yellow`, `Black`. Sizes: `XLarge`, `Large`, `Medium`, `Small`, `XSmall`. Shipping: `Land`, `Air`, `Sea`.

Run these examples in order against a fresh database, optionally populated with `db:seed`. Create a duck (sending it again adds to its stock):

```sh
curl -s http://localhost:3001/api/ducks \
  -H 'Content-Type: application/json' \
  -d '{"color":"Red","size":"Medium","price":10,"quantity":5}'
```

```json
{ "id": 8, "color": "Red", "size": "Medium", "price": "10.00", "quantity": 5, "deleted": false }
```

The example ID is `8` after seeding; use the ID actually returned by your server. Before editing or deleting this duck, calculate an order using its `$10.00` price (there must be exactly one active Red/Medium duck):

```sh
curl -s http://localhost:3001/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"color":"Red","size":"Medium","quantity":101,"destinationCountry":"USA","shippingMode":"Sea"}'
```

```json
{
  "packageType": "Cardboard",
  "protectionTypes": ["Moisture-absorbing beads", "Bubble wrap"],
  "currency": "USD",
  "quantity": 101,
  "unitPrice": "10.00",
  "merchandiseSubtotal": "1010.00",
  "adjustments": [
    { "code": "VOLUME_DISCOUNT", "description": "20% discount for more than 100 ducks", "base": "1010.00", "rate": "-0.20", "amount": "-202.00" },
    { "code": "PACKAGING", "description": "Cardboard packaging adjustment", "base": "808.00", "rate": "-0.01", "amount": "-8.08" },
    { "code": "DESTINATION", "description": "Destination charge (USA)", "base": "799.92", "rate": "0.18", "amount": "143.99" },
    { "code": "SHIPPING", "description": "Sea shipping", "base": "400.00", "amount": "400.00" }
  ],
  "shipping": { "mode": "Sea", "baseAmount": "400.00", "discountAmount": "0.00", "totalAmount": "400.00" },
  "totalAmount": "1343.91"
}
```

`adjustments` lists every signed charge and discount in the order applied, including shipping; `base` is the amount each percentage was taken from. `shipping` summarizes those same shipping lines, so don't add it again. Rates are decimal fractions.

Finally, edit and delete the duck, replacing `8` with the ID returned when you created it:

```sh
curl -s -X PATCH http://localhost:3001/api/ducks/8 \
  -H 'Content-Type: application/json' -d '{"quantity":0,"price":"10.50"}'
curl -i -X DELETE http://localhost:3001/api/ducks/8
```

Errors look like `{ "error": { "code": "...", "message": "...", "fieldErrors": { "price": ["..."] } } }`. `fieldErrors` appears only on validation errors; form-level messages use the `_form` key.

| Status | Codes                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------- |
| `400`  | `VALIDATION_ERROR`, `INVALID_JSON`, `BAD_REQUEST` (an unreadable request, such as a malformed URL)  |
| `404`  | `DUCK_NOT_FOUND`, `ROUTE_NOT_FOUND`                                                                 |
| `409`  | `DUCK_ALREADY_EXISTS`, `QUANTITY_LIMIT_EXCEEDED`, `AMBIGUOUS_DUCK_PRICE`, `CONCURRENT_MODIFICATION` |
| `413`  | `BODY_TOO_LARGE` (JSON over 16 KB)                                                                  |
| `415`  | `UNSUPPORTED_MEDIA_TYPE` (a body that is not UTF-8 JSON)                                            |
| `500`  | `INTERNAL_ERROR` (details are logged on the server, not returned)                                   |

## Decisions and assumptions

- **Sorting:** quantity descending, as in the mockup, with ID ascending as a tie-breaker.
- **Merging:** adding a duck merges into an active duck with the same color, size, and price. Deleted ducks are treated as gone: adding a match creates a new duck rather than restoring a deleted one with its old stock, and deleted ducks never block an edit. Color/size/price is therefore unique among active ducks only (a generated column in the unique index is `NULL` for deleted rows), and an edit that would collide with an active duck returns `409`. Edits never merge ducks.
- **Editing and deleting:** PATCH accepts only price and absolute quantity, requires at least one, and returns `404` for deleted ducks. DELETE returns `204` for any known duck, including one already deleted, and `404` for unknown IDs.
- **Limits:** IDs and quantities are MySQL `INT` (max `2,147,483,647`). Added and ordered quantities must be positive; edited quantities may be zero. A merge that would overflow returns `409` and changes nothing.
- **Money:** the spec types Price as Double, but prices are stored as `DECIMAL(10,2)` and calculated with decimal.js so money stays exact. Prices range from `$0.01` to `$99,999,999.99` with at most two decimal places.
- **Order total:** steps apply in the spec's order, each to the running total. The spec starts from the "initial total cost" and then adjusts "the total cost" step by step. Shipping is added after the percentages, and the Air discount applies to the Air shipping cost only.
- **Rounding:** each adjustment rounds to the nearest cent, with halves rounded away from zero (so a −$0.005 discount becomes −$0.01), and the listed lines always sum exactly to the total.
- **Price lookup for orders:** an order names color and size, not price, so it uses the single active duck with that color and size, regardless of stock. No match returns `404`; several prices return `409 AMBIGUOUS_DUCK_PRICE`. Orders don't check or reduce stock.
- **Destinations:** `USA`, `Bolivia`, and `India` match case-insensitively after trimming; any other country gets 15%. `US` is not treated as `USA`.
- **UI:** Add and Edit share one modal form, with color and size read-only on Edit. Edits send only changed fields, preserving newer changes to untouched fields; an unchanged form closes without a request. Competing edits to the same field remain last-write-wins. Changes wait for the server and then reload the sorted table. Adding a duck that matches an existing one says so and shows the new quantity. Failed forms keep their input, and deleting asks for confirmation.
- **Retries:** Add is not idempotent and is never retried automatically. If the connection drops during a change, the server may still have saved it, so the form keeps its input and says the save couldn't be confirmed; refresh the inventory before submitting again.
- **Store UI:** the spec makes Store backend-only, so it is shown as unavailable in the navigation.
- **Database connection:** For a project expected to grow over the years, I would use an ORM, as it would be a lot easier to maintain. I would personally use Prisma, as it is a very popular ORM, has a lot of support, and I've really enjoyed my time using it. For this spec, I kept it simple with raw SQL, which also lets the Add merge run as one atomic `INSERT ... ON DUPLICATE KEY UPDATE` statement.

## Pricing examples

Each example assumes one matching active duck at `$10.00`. Each percentage applies to the running total above it.

| Line                                     | 101 Medium / USA / Sea | 1,001 Large / USA / Air |
| ---------------------------------------- | ---------------------: | ----------------------: |
| Merchandise subtotal                     |              $1,010.00 |              $10,010.00 |
| Quantity discount (−20%, over 100)       |               −$202.00 |              −$2,002.00 |
| Package (Cardboard −1% / Wood +5%)       |                 −$8.08 |                +$400.40 |
| USA charge (+18%)                        |               +$143.99 |              +$1,513.51 |
| Shipping                                 |               +$400.00 |             +$30,030.00 |
| Air shipping discount (−15%, over 1,000) |                      — |              −$4,504.50 |
| **Total**                                |          **$1,343.91** |          **$35,447.41** |

Exactly 100 units gets no quantity discount, and exactly 1,000 gets no Air discount.

Fractional cents: one Large duck at `$0.10`, Sea, to an unlisted country. Wood: `0.10 × 5% = 0.005`, which rounds to `$0.01`, leaving `$0.11`. Country: `0.11 × 15% = 0.0165`, which rounds to `$0.02`. Total: `0.10 + 0.01 + 0.02 + 400.00 = $400.13`.

## Code guide

The spec asks for design patterns in packaging (2.3) and the order total (2.4):

- **2.3 Packaging, Strategy pattern** (`server/src/pricing.ts`): `packageBySize` maps size to material, and `protectionStrategies` holds one protection strategy per shipping mode.
- **2.4 Order total, rule pipeline** (`server/src/pricing.ts`): `merchandiseRules` is an ordered list of small rule functions. Each rule receives the running total and may return a signed adjustment, so adding a rule means adding one function. Shipping follows as a Strategy: `shippingStrategies` prices each mode, including the Air discount on Air shipping.
- **Repository** (`server/src/ducks.ts`): `duckRepository` keeps all SQL out of the routes. Matching additions are serialized by the active-duck unique index and `INSERT ... ON DUPLICATE KEY UPDATE` ([MySQL docs](https://dev.mysql.com/doc/refman/8.4/en/insert-on-duplicate.html)). Strict SQL mode makes quantity overflow an error instead of silently clamping it, and database errors map to stable HTTP errors.

Elsewhere:

- `shared/contracts.ts` holds public API types, allowed values, and ID/quantity limits used by both the browser and server. It has no server dependencies. `server/src/index.ts` sets up Express and the routes; `validation.ts` validates requests against that contract.
- `client/src/` is flat. `App.tsx` is the page frame and navigation. `WarehousePage.tsx` owns the inventory table, notices, and which dialog is open; `useInventory.ts` loads and refreshes the ducks, ignoring stale responses. `DuckFormDialog.tsx` (shared by Add and Edit) and `DeleteDuckDialog.tsx` keep their inputs and pending state local. `duckEdits.ts` sends only the fields an edit changed, and `api.ts` wraps the requests.
- `Dialog.tsx` wraps the native `<dialog>`, which handles modal behavior and Escape; Tab is kept inside the dialog, and focus returns to the control that opened it, or to Add Duck when that control's row was deleted. `Button.tsx` is the one shared control.
- Each component's styles sit beside it as a CSS Module; `client/src/styles.css` holds global resets, design tokens, and the alert styles used on the page and in both dialogs. The production build emits the server entry point at `dist/server/src/index.js`, shared contracts at `dist/shared/`, and the frontend at `dist/client/`.
- `server/db/schema.sql` is the single, repeatable schema.

## AI assistance

Codex helped refine ambiguous requirements, implement the UI/API and SQL, and check the running application. Claude Code later helped restructure the project, review it against the specification, and apply the resulting fixes. That review flagged the ambiguous order-total wording, and I went with the running-total reading explained under Decisions and assumptions. The behavior and assumptions above were reviewed explicitly by me, mytch.
