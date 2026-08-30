# OpenPets / OpenPetsKit attribution

Piora's standalone companion window contains a modified React/CSS adaptation
of the transient task-bubble and reserved message-area behavior implemented by
OpenPets and OpenPetsKit. The adaptation maps Piora's existing Pi task states
to a compact title, detail, and status indicator while retaining Piora's own
Electron window, Codex-compatible sprite renderer, and local storage model.

Upstream snapshots reviewed:

- OpenPets commit: `6855f9daa95dcdb19fe6caf6b0a28e2e578bb5e0`
- OpenPets catalog/assets commit: `6c8187c4b67d4e27c6e4e573530bd74b5e998c75`
- OpenPetsKit commit: `d57f8b4b7312fb15cc123e76a3b9ac1bdedf4ad3`
- OpenPets repository: <https://github.com/alterhq/openpets>
- OpenPetsKit repository: <https://github.com/alterhq/OpenPetsKit>
- Display configuration: <https://github.com/alterhq/OpenPetsKit/blob/d57f8b4b7312fb15cc123e76a3b9ac1bdedf4ad3/Sources/OpenPetsKit/OpenPetsDisplayConfiguration.swift>
- Host and bubble behavior: <https://github.com/alterhq/OpenPetsKit/blob/d57f8b4b7312fb15cc123e76a3b9ac1bdedf4ad3/Sources/OpenPetsKit/OpenPetsHost.swift>
- Upstream license: MIT
- Upstream copyright: Copyright (c) 2026 OpenPets contributors

No OpenPets executable, Swift source file, or logo is bundled by Piora. The
implementation was rewritten for Piora's Electron/React runtime. Piora also
redistributes eight OpenPets-original companion packages from the public v3
catalog: `azure`, `corgi-scout`, `fox`, `patchi`, `penguin`,
`professor-hoot`, `rabbit`, and `shadow-kit`. Their unmodified `pet.json` and
`spritesheet.webp` files live under `public/companion-pets/bundled/` and are
covered by the upstream MIT license reproduced in this folder and included in
packaged desktop distributions.
