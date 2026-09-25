-- Cardápio mais completo: foto do produto (URL — sem pipeline de upload
-- por enquanto, cola o link de uma imagem já hospedada em algum lugar).

alter table restaurante.produtos add column if not exists foto_url text;
