# PayPal responses for the adapter's tests

- `order-payer-action-required.json`: recorded from the PayPal sandbox on 16 October 2026 (`GET /v2/checkout/orders/{id}` after Kin created a top-up order). The pool's sandbox email and merchant ID are replaced with placeholders.
- `order-completed.json`: recorded from the PayPal sandbox on 16 October 2026: the first top-up through Kin, approved by a sandbox buyer, captured, and read back with `GET /v2/checkout/orders/{id}`. $100.00 gross, a $3.98 fee. The payer's and the pool's names, emails and account IDs are placeholders, and `custom_id` names the fixture's circle and member.
