# Responsive and accessibility checklist

Validation completed on 2026-10-30 in Chromium using the local frontend.

## Responsive layout

| Viewport | Registration/login | Study material dashboard | Horizontal overflow |
|---|---|---|---|
| 320 × 720 | Pass | Pass | None |
| 768 × 1024 | Pass | Pass | None |
| 1440 × 900 | Pass | Pass | None |

The dashboard check included a long material title to verify wrapping at narrow widths.

## Keyboard and semantics

- [x] Account mode controls are native buttons, expose pressed state, and can be reached with Tab.
- [x] Enter activates the focused account mode button.
- [x] Keyboard focus is clearly visible on interactive controls.
- [x] Registration field errors are associated with their inputs; validation state is exposed with `aria-invalid`.
- [x] Forms, field labels, role choices, status messages, and dashboard sections have accessible names or roles.

## Text contrast

Measured text and control combinations meet the WCAG AA 4.5:1 minimum:

| Combination | Contrast |
|---|---:|
| Primary button text | 6.34:1 |
| Muted text on the page background | 5.36:1 |
| Field error text | 6.05:1 |
| Error feedback text | 7.80:1 |
| Success feedback text | 6.72:1 |
| Secondary button text | 7.21:1 |

