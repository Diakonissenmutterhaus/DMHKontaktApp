import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { normalizeContactBirthday } from "./contactBirthday";
import { emptyContact, toContactInput } from "./contact";
import { mapRows } from "./importers";
import { exportGeneralCsv, exportNewOutlookCsv, exportOutlookClassicCsv } from "./exporters";
import type { Contact } from "../types/contact";

describe("contact birthdays", () => {
  it("preserves wall dates, including leap days and birthdays without a known year", () => {
    expect(normalizeContactBirthday("1980-02-29T23:00:00-07:00")).toBe("1980-02-29");
    expect(normalizeContactBirthday("1604-02-29")).toBe("1604-02-29");
    expect(normalizeContactBirthday("12.06.1975")).toBe("1975-06-12");
    expect(normalizeContactBirthday("19750612")).toBe("1975-06-12");
    for (const date of [undefined, "", "2025-02-29", "4501-01-01", "1975-06-12garbage"]) expect(normalizeContactBirthday(date)).toBe("");
  });

  it("keeps birthdays through editing and all CSV exports/imports", () => {
    const contact: Contact = { ...emptyContact, id: 1, displayName: "Example", email: "example@example.test", birthday: "1975-06-12", groups: [], createdAt: "", updatedAt: "" };
    expect(toContactInput(contact).birthday).toBe(contact.birthday);
    for (const exporter of [exportGeneralCsv, exportOutlookClassicCsv, exportNewOutlookCsv]) {
      const csv = Papa.parse<Record<string, unknown>>(exporter([contact]), { header: true, delimiter: ";" }).data;
      const birthdayHeader = csv[0].Geburtstag ? "Geburtstag" : "Birthday";
      const emailHeader = ["E-Mail geschäftlich", "E-mail Address", "Email Address"].find((name) => name in csv[0]);
      const imported = mapRows(csv, { birthday: birthdayHeader, email: emailHeader });
      expect(imported[0].birthday).toBe(contact.birthday);
    }
  });
});
