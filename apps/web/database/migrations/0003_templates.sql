CREATE TABLE post_templates (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  sort_order integer NOT NULL,
  active boolean NOT NULL DEFAULT true
);
-- Editable editorial starting points; never imported social history.
INSERT INTO post_templates (id, payload, sort_order) VALUES
('morning', '{"id":"morning","name":"Një mëngjes i mirë","title":"Mëngjesi nis këtu.","caption":"Kafe e freskët dhe një moment për veten. Të presim në lagje. ☕","goal":"Prezanto produktin","industry":"Gastronomi","image":"/images/coffee.jpg","channel":"Instagram","topic":"Produkti"}', 1),
('space', '{"id":"space","name":"Hapësira ku ndihemi mirë","title":"Një vend për biseda të mira.","caption":"Për pushimin e shkurtër, takimin me miqtë apo idenë e radhës. Gjithmonë ka një vend për ty.","goal":"Trego atmosferën","industry":"Mikpritje","image":"/images/interior.jpg","channel":"Facebook","topic":"Atmosfera"}', 2),
('product', '{"id":"product","name":"Detajet bëjnë diferencën","title":"Pak ëmbëlsi në mes të ditës.","caption":"Gjërat e vogla e bëjnë ditën më të bukur. Cila është zgjedhja jote sot?","goal":"Ndaj një moment","industry":"Gastronomi","image":"/images/pastry.jpg","channel":"Instagram","topic":"Produkti"}', 3),
('community', '{"id":"community","name":"Njerëzit e bëjnë vendin","title":"Njerëzit e bëjnë vendin.","caption":"Një tavolinë, një bisedë dhe njerëz të mirë. Me kë do ta ndaje këtë moment?","goal":"Afro komunitetin","industry":"Mikpritje","image":"/images/table.jpg","channel":"Instagram","topic":"Komuniteti"}', 4);
