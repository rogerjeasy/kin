# PayPal responses for the adapter's tests

- `order-payer-action-required.json`: recorded from the PayPal sandbox on 16 October 2026 (`GET /v2/checkout/orders/{id}` after Kin created a top-up order). The pool's sandbox email and merchant ID are replaced with placeholders.
- `order-completed.json`: the same order after capture, in the shape of PayPal's Orders v2 capture response. Replace it with a recorded one once a sandbox buyer has approved a top-up.
