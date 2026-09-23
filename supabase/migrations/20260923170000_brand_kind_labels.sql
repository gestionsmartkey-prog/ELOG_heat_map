-- seller kind labels and brand colours, as they are in production.
-- 0001 seeded the first draft; this brings a fresh database (or a preview branch) to the same state.
update public.seller_kinds k set label = v.label, color = v.color
from (values
  ('seller', 'Seller', '#FF9038'),
  ('dropoff_agency', 'Centro de envío', '#2B6E8F'),
  ('partner', 'Partner', '#2E7D5B'),
  ('unknown', 'Sin clasificar', '#A3A09E')
) as v(kind, label, color)
where k.kind = v.kind and (k.label is distinct from v.label or k.color is distinct from v.color);
