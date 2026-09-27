CREATE TABLE IF NOT EXISTS ducks (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  color ENUM('Red', 'Green', 'Yellow', 'Black') NOT NULL,
  size ENUM('XLarge', 'Large', 'Medium', 'Small', 'XSmall') NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  quantity INT NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  -- NULL for deleted ducks. A unique index allows repeated NULLs, so only active ducks must be unique.
  active_identity TINYINT AS (IF(deleted, NULL, 1)) VIRTUAL,
  CONSTRAINT duck_identity UNIQUE (color, size, price, active_identity),
  CONSTRAINT positive_price CHECK (price > 0),
  CONSTRAINT valid_quantity CHECK (quantity BETWEEN 0 AND 2147483647),
  CONSTRAINT valid_deleted CHECK (deleted IN (0, 1))
) ENGINE=InnoDB;
