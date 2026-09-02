# Images first, multimodal-ready

**What**: Users can paste or attach an image into a chat whenever the connected model supports vision, so Mayon exercises the capabilities of the models it connects to.
**Why**: The composer and the server LLM path are text-only today, so multimodal models deliver none of that value inside Mayon — the core loop of showing the model what you see is impossible.

## The path

You ship images only, built on a parts-based message architecture designed in anticipation of every other modality. Messages stop being a string and become content parts — text and image now, with voice, files, and video as follow-on slices rather than a rewrite. The composer learns paste and attach with thumbnail previews; the server proxy passes parts through to the provider untouched; a vision flag from the provider config gates the paperclip. Week one, you paste a stack-trace screenshot and the model reads it — that's the demo. From then on the contract pays out: each new modality is a slice on the same bones.

## Known snags

- Retina screenshots arrive at ~3 MB — client-side compress/downsize before upload is day-one work, not polish (mild, early).
- `search_vec` is a generated column over message text — the parts migration must keep it extracting from the text part; touches an invariant, needs a test (once, sneaky).
- Capability advertisement is fuzzy across providers — ship permissive-with-a-clear-error, don't pretend the gate is omniscient (continuous, mild–medium).
- Images are token-heavy — context fills faster and metered-API users notice; a token-cost affordance earns its keep (medium, post-launch).
- Blob storage was examined during the playthrough and resolved: at single-user local scale (~1–2 GB/yr est.), image bytes live in Postgres with the message and ride the pg_dump backup story — conditional on client-side downsizing.

## Accepted trade-offs

- Voice, files, and video defer — the contract keeps them cheap to add, but they ship later, gated by demand.
- No extraction pipeline: documents-as-text is not delivered by this path (the reframe card lost the bet — the why is images the model can see).
- Per-modality depth starts shallow: paste, attach, and preview only.

## The bet

This wins if vision is the demand that matters now (~90% of real usage) and a parts-first architecture makes every later modality a slice — delivering Card 001's destination at Card 002's price.
