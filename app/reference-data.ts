export type ContactMethod = {
  label: string;
  value: string;
  href: string;
  kind: "phone" | "email";
};

export type ContactEntry = {
  id: string;
  name: string;
  role?: string;
  note?: string;
  methods?: ContactMethod[];
};

export type ContactGroup = {
  title: string;
  contacts: ContactEntry[];
};

export type ReferenceLink = {
  label: string;
  href: string;
  note?: string;
  kind?: "phone" | "email" | "web";
};

export type ReferenceSection = {
  title: string;
  copy?: string;
  bullets?: string[];
  links?: ReferenceLink[];
  callout?: string;
};

export type QuickReference = {
  id: string;
  title: string;
  summary: string;
  badge: string;
  sections: ReferenceSection[];
};

export type ReferenceVault = {
  contactGroups: ContactGroup[];
  quickReferences: QuickReference[];
  updatedAt?: string;
};
