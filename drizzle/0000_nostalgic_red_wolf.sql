CREATE TABLE `calendar_feeds` (
	`token` text PRIMARY KEY NOT NULL,
	`calendar_name` text NOT NULL,
	`ics` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
