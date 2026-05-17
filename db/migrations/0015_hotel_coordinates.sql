-- PHI-111 — persist hotel coordinates from welcome step 2.
--
-- The PHI-105 anchor-resolution feature, PHI-102 popular-picks neighbourhood
-- weighting, and future hotel-anchored travel-connector defaults all need
-- the hotel's coordinates on the row, not just its free-text name. Today
-- only `legs[*].hotel` (the name string) is persisted; this card surfaces
-- the four-field rich Place payload so downstream features can read where
-- the hotel actually is.
--
-- The trip schema's source of truth is `legs` JSONB (TripLeg has new
-- optional `hotelPlaceId`, `hotelLat`, `hotelLng`, `hotelNeighborhood`
-- fields per leg, so multi-leg trips get one hotel coordinate set per
-- leg). These four flat columns mirror legs[0]'s hotel coordinates as a
-- convenience for single-leg-aware consumers — they keep the simple
-- "read the trip's hotel coords" path one query away without forcing
-- every downstream feature to walk the legs array.
--
-- All four columns are nullable. Existing rows take NULL — legacy travellers
-- whose hotel was captured pre-PHI-111 keep their `legs[*].hotel` name
-- string and stay null on coords; downstream features fall back to their
-- no-hotel behaviour for those rows.
--
-- Additive + idempotent. Re-running applies cleanly.

alter table travelers
  add column if not exists hotel_place_id text,
  add column if not exists hotel_lat double precision,
  add column if not exists hotel_lng double precision,
  add column if not exists hotel_neighborhood text;
