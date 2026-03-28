"""
seed_db.py — AES Veritabanı Kapsamlı Dolgu Scripti

Almanya'daki ~120 üniversite × ~70 program kombinasyonu → ~5.000+ kayıt
Çalıştır: python seed_db.py [--clear] [--stats]
"""

import argparse
import hashlib
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent / "programs.db"
NOW = datetime.now().isoformat()


# ─── ÜNİVERSİTELER ─────────────────────────────────────────────────────────────
# (isim, şehir, eyalet, türü, uni_assist_gerekli, güven_skoru)

UNIVERSITIES = [
    # ── TU9 Alliance ──────────────────────────────────────────────────────────
    ("TU München (TUM)",          "München",      "Bayern",             "TU", True,  0.95),
    ("RWTH Aachen",               "Aachen",       "NRW",                "TU", True,  0.95),
    ("TU Berlin",                 "Berlin",       "Berlin",             "TU", True,  0.95),
    ("TU Darmstadt",              "Darmstadt",    "Hessen",             "TU", True,  0.93),
    ("KIT Karlsruhe",             "Karlsruhe",    "Baden-Württemberg",  "TU", True,  0.93),
    ("Universität Stuttgart",     "Stuttgart",    "Baden-Württemberg",  "TU", True,  0.93),
    ("TU Dresden",                "Dresden",      "Sachsen",            "TU", True,  0.93),
    ("Leibniz Universität Hannover","Hannover",   "Niedersachsen",      "TU", True,  0.90),
    ("TU Braunschweig",           "Braunschweig", "Niedersachsen",      "TU", True,  0.90),

    # ── Exzellenzuniversitäten ────────────────────────────────────────────────
    ("LMU München",               "München",      "Bayern",             "U",  True,  0.93),
    ("Universität Heidelberg",    "Heidelberg",   "Baden-Württemberg",  "U",  True,  0.93),
    ("Freie Universität Berlin",  "Berlin",       "Berlin",             "U",  True,  0.90),
    ("Humboldt-Universität Berlin","Berlin",      "Berlin",             "U",  True,  0.90),
    ("Universität Bonn",          "Bonn",         "NRW",                "U",  True,  0.90),
    ("Universität Konstanz",      "Konstanz",     "Baden-Württemberg",  "U",  False, 0.88),
    ("Universität Tübingen",      "Tübingen",     "Baden-Württemberg",  "U",  True,  0.90),
    ("Universität Freiburg",      "Freiburg",     "Baden-Württemberg",  "U",  True,  0.90),
    ("Universität Hamburg",       "Hamburg",      "Hamburg",            "U",  True,  0.90),
    ("Universität Frankfurt (Goethe)","Frankfurt","Hessen",             "U",  True,  0.90),
    ("Universität Münster",       "Münster",      "NRW",                "U",  True,  0.88),
    ("Universität Köln",          "Köln",         "NRW",                "U",  True,  0.88),
    ("Universität Göttingen",     "Göttingen",    "Niedersachsen",      "U",  True,  0.88),
    ("Universität Mainz (JGU)",   "Mainz",        "Rheinland-Pfalz",    "U",  True,  0.88),
    ("Universität Mannheim",      "Mannheim",     "Baden-Württemberg",  "U",  True,  0.90),
    ("Universität Erlangen-Nürnberg (FAU)","Erlangen","Bayern",         "U",  True,  0.88),
    ("Universität Würzburg",      "Würzburg",     "Bayern",             "U",  True,  0.85),
    ("Universität Regensburg",    "Regensburg",   "Bayern",             "U",  True,  0.85),
    ("Universität Augsburg",      "Augsburg",     "Bayern",             "U",  True,  0.85),
    ("Universität Bayreuth",      "Bayreuth",     "Bayern",             "U",  True,  0.85),
    ("Universität Passau",        "Passau",       "Bayern",             "U",  False, 0.83),
    ("Universität Duisburg-Essen","Duisburg",     "NRW",                "U",  True,  0.83),
    ("Universität Bielefeld",     "Bielefeld",    "NRW",                "U",  True,  0.83),
    ("Universität Bochum (RUB)",  "Bochum",       "NRW",                "U",  True,  0.85),
    ("TU Dortmund",               "Dortmund",     "NRW",                "TU", True,  0.85),
    ("Universität Düsseldorf (HHU)","Düsseldorf", "NRW",                "U",  True,  0.85),
    ("Universität Paderborn",     "Paderborn",    "NRW",                "U",  False, 0.83),
    ("Universität Siegen",        "Siegen",       "NRW",                "U",  False, 0.80),
    ("Universität Wuppertal",     "Wuppertal",    "NRW",                "U",  False, 0.80),
    ("Universität Marburg",       "Marburg",      "Hessen",             "U",  True,  0.83),
    ("Universität Gießen (JLU)",  "Gießen",       "Hessen",             "U",  True,  0.83),
    ("Universität Kassel",        "Kassel",       "Hessen",             "U",  False, 0.80),
    ("Universität Bremen",        "Bremen",       "Bremen",             "U",  False, 0.85),
    ("Universität Oldenburg",     "Oldenburg",    "Niedersachsen",      "U",  False, 0.83),
    ("Universität Osnabrück",     "Osnabrück",    "Niedersachsen",      "U",  False, 0.80),
    ("Universität Hildesheim",    "Hildesheim",   "Niedersachsen",      "U",  False, 0.78),
    ("Universität Kiel (CAU)",    "Kiel",         "Schleswig-Holstein", "U",  True,  0.83),
    ("Universität Lübeck",        "Lübeck",       "Schleswig-Holstein", "U",  False, 0.80),
    ("Universität Rostock",       "Rostock",      "Mecklenburg-VP",     "U",  True,  0.80),
    ("Universität Greifswald",    "Greifswald",   "Mecklenburg-VP",     "U",  True,  0.78),
    ("Universität Leipzig",       "Leipzig",      "Sachsen",            "U",  True,  0.83),
    ("Universität Halle (MLU)",   "Halle",        "Sachsen-Anhalt",     "U",  True,  0.80),
    ("Universität Jena (FSU)",    "Jena",         "Thüringen",          "U",  True,  0.80),
    ("Universität Erfurt",        "Erfurt",       "Thüringen",          "U",  False, 0.75),
    ("Universität Saarbrücken",   "Saarbrücken",  "Saarland",           "U",  True,  0.80),
    ("Universität Trier",         "Trier",        "Rheinland-Pfalz",    "U",  False, 0.78),
    ("Universität Koblenz-Landau","Koblenz",      "Rheinland-Pfalz",    "U",  False, 0.78),
    ("Universität Kaiserslautern-Landau (RPTU)","Kaiserslautern","Rheinland-Pfalz","TU",False,0.80),
    ("Universität Ulm",           "Ulm",          "Baden-Württemberg",  "U",  True,  0.83),
    ("Universität Hohenheim",     "Stuttgart",    "Baden-Württemberg",  "U",  True,  0.80),
    ("Universität Mannheim",      "Mannheim",     "Baden-Württemberg",  "U",  True,  0.88),

    # ── Technische Hochschulen & Spezialisiert ────────────────────────────────
    ("Jacobs University Bremen",  "Bremen",       "Bremen",             "U",  False, 0.85),
    ("Constructor University Bremen","Bremen",    "Bremen",             "U",  False, 0.83),
    ("Frankfurt School of Finance","Frankfurt",   "Hessen",             "U",  False, 0.85),
    ("WHU – Otto Beisheim School","Vallendar",    "Rheinland-Pfalz",    "U",  False, 0.83),
    ("EBS Universität",           "Wiesbaden",    "Hessen",             "U",  False, 0.80),
    ("Universität der Bundeswehr München","München","Bayern",           "U",  False, 0.78),
    ("Universität der Bundeswehr Hamburg","Hamburg","Hamburg",          "U",  False, 0.78),
    ("Deutsche Universität für Verwaltungswissenschaften","Speyer","Rheinland-Pfalz","U",False,0.75),

    # ── Fachhochschulen / HAW (Hochschulen für Angewandte Wissenschaften) ────
    ("Hochschule München (HM)",   "München",      "Bayern",             "FH", False, 0.85),
    ("Hochschule Augsburg (HSA)", "Augsburg",     "Bayern",             "FH", False, 0.80),
    ("Hochschule Würzburg-Schweinfurt","Würzburg","Bayern",             "FH", False, 0.78),
    ("OTH Regensburg",            "Regensburg",   "Bayern",             "FH", False, 0.78),
    ("OTH Amberg-Weiden",         "Amberg",       "Bayern",             "FH", False, 0.75),
    ("Hochschule Coburg",         "Coburg",       "Bayern",             "FH", False, 0.75),
    ("Hochschule Ingolstadt (THI)","Ingolstadt",  "Bayern",             "FH", False, 0.78),
    ("Hochschule Landshut",       "Landshut",     "Bayern",             "FH", False, 0.75),
    ("HAW Hamburg",               "Hamburg",      "Hamburg",            "FH", False, 0.83),
    ("Hochschule Bremen (HSB)",   "Bremen",       "Bremen",             "FH", False, 0.82),
    ("Hochschule Bremerhaven",    "Bremerhaven",  "Bremen",             "FH", False, 0.75),
    ("HMKW Berlin",               "Berlin",       "Berlin",             "FH", False, 0.72),
    ("HTW Berlin",                "Berlin",       "Berlin",             "FH", False, 0.80),
    ("HWR Berlin",                "Berlin",       "Berlin",             "FH", False, 0.80),
    ("Hochschule für Technik und Wirtschaft Berlin (HTW)","Berlin","Berlin","FH",False,0.80),
    ("Beuth Hochschule Berlin",   "Berlin",       "Berlin",             "FH", False, 0.78),
    ("Fachhochschule Dortmund",   "Dortmund",     "NRW",                "FH", False, 0.78),
    ("FH Aachen",                 "Aachen",       "NRW",                "FH", False, 0.80),
    ("FH Köln (TH Köln)",         "Köln",         "NRW",                "FH", False, 0.82),
    ("Hochschule Düsseldorf",     "Düsseldorf",   "NRW",                "FH", False, 0.80),
    ("Hochschule Bonn-Rhein-Sieg","Bonn",         "NRW",                "FH", False, 0.80),
    ("Hochschule Bochum",         "Bochum",       "NRW",                "FH", False, 0.78),
    ("Westfälische Hochschule",   "Gelsenkirchen","NRW",                "FH", False, 0.75),
    ("Hochschule Ruhr West",      "Mülheim",      "NRW",                "FH", False, 0.75),
    ("FH Münster",                "Münster",      "NRW",                "FH", False, 0.80),
    ("Hochschule Osnabrück",      "Osnabrück",    "Niedersachsen",      "FH", False, 0.78),
    ("Ostfalia HS Braunschweig",  "Wolfenbüttel", "Niedersachsen",      "FH", False, 0.78),
    ("HAWK Hildesheim",           "Hildesheim",   "Niedersachsen",      "FH", False, 0.75),
    ("Hochschule Hannover",       "Hannover",     "Niedersachsen",      "FH", False, 0.78),
    ("HS Flensburg",              "Flensburg",    "Schleswig-Holstein", "FH", False, 0.75),
    ("FH Kiel",                   "Kiel",         "Schleswig-Holstein", "FH", False, 0.75),
    ("Hochschule Wismar",         "Wismar",       "Mecklenburg-VP",     "FH", False, 0.75),
    ("Hochschule Stralsund",      "Stralsund",    "Mecklenburg-VP",     "FH", False, 0.73),
    ("HTW Dresden",               "Dresden",      "Sachsen",            "FH", False, 0.78),
    ("HTWK Leipzig",              "Leipzig",      "Sachsen",            "FH", False, 0.78),
    ("HS Mittweida",              "Mittweida",    "Sachsen",            "FH", False, 0.73),
    ("FH Erfurt",                 "Erfurt",       "Thüringen",          "FH", False, 0.73),
    ("Ernst-Abbe-HS Jena",        "Jena",         "Thüringen",          "FH", False, 0.73),
    ("HS Merseburg",              "Merseburg",    "Sachsen-Anhalt",     "FH", False, 0.72),
    ("Hochschule Magdeburg-Stendal","Magdeburg",  "Sachsen-Anhalt",     "FH", False, 0.73),
    ("HS Anhalt",                 "Köthen",       "Sachsen-Anhalt",     "FH", False, 0.72),
    ("Hochschule Trier",          "Trier",        "Rheinland-Pfalz",    "FH", False, 0.73),
    ("HS Kaiserslautern",         "Kaiserslautern","Rheinland-Pfalz",   "FH", False, 0.73),
    ("HS Mainz",                  "Mainz",        "Rheinland-Pfalz",    "FH", False, 0.75),
    ("HS RheinMain",              "Wiesbaden",    "Hessen",             "FH", False, 0.75),
    ("HS Darmstadt",              "Darmstadt",    "Hessen",             "FH", False, 0.78),
    ("FH Frankfurt",              "Frankfurt",    "Hessen",             "FH", False, 0.78),
    ("HS Fulda",                  "Fulda",        "Hessen",             "FH", False, 0.73),
    ("HS Offenburg",              "Offenburg",    "Baden-Württemberg",  "FH", False, 0.75),
    ("HS Karlsruhe (HKA)",        "Karlsruhe",    "Baden-Württemberg",  "FH", False, 0.80),
    ("HS Mannheim",               "Mannheim",     "Baden-Württemberg",  "FH", False, 0.78),
    ("HS Heilbronn",              "Heilbronn",    "Baden-Württemberg",  "FH", False, 0.78),
    ("HS Pforzheim",              "Pforzheim",    "Baden-Württemberg",  "FH", False, 0.75),
    ("HS Reutlingen",             "Reutlingen",   "Baden-Württemberg",  "FH", False, 0.78),
    ("HS Esslingen",              "Esslingen",    "Baden-Württemberg",  "FH", False, 0.78),
    ("HS Ulm",                    "Ulm",          "Baden-Württemberg",  "FH", False, 0.75),
    ("HS Aalen",                  "Aalen",        "Baden-Württemberg",  "FH", False, 0.75),
    ("HS Konstanz (HTWG)",        "Konstanz",     "Baden-Württemberg",  "FH", False, 0.78),
    ("HS Ravensburg-Weingarten",  "Weingarten",   "Baden-Württemberg",  "FH", False, 0.73),
    ("HS Furtwangen (HFU)",       "Furtwangen",   "Baden-Württemberg",  "FH", False, 0.75),
    ("HS Nürtingen-Geislingen",   "Nürtingen",    "Baden-Württemberg",  "FH", False, 0.73),
    ("HS für Technik Stuttgart (HFT)","Stuttgart","Baden-Württemberg",  "FH", False, 0.75),
    ("Duale Hochschule BW Stuttgart","Stuttgart", "Baden-Württemberg",  "FH", False, 0.75),
    ("HS Niederrhein",            "Krefeld",      "NRW",                "FH", False, 0.75),
    ("HS Hamm-Lippstadt",         "Hamm",         "NRW",                "FH", False, 0.73),
    ("HS Bielefeld",              "Bielefeld",    "NRW",                "FH", False, 0.75),
    ("HS OWL",                    "Detmold",      "NRW",                "FH", False, 0.73),
    ("Hochschule Kempten",        "Kempten",      "Bayern",             "FH", False, 0.73),
    ("Hochschule Neu-Ulm",        "Neu-Ulm",      "Bayern",             "FH", False, 0.73),
    ("HS Weihenstephan-Triesdorf","Weihenstephan","Bayern",             "FH", False, 0.72),
    ("Universität Potsdam",       "Potsdam",      "Brandenburg",        "U",  True,  0.82),
    ("BTU Cottbus",               "Cottbus",      "Brandenburg",        "TU", False, 0.78),
    ("Europa-Universität Viadrina","Frankfurt/Oder","Brandenburg",      "U",  False, 0.75),
    ("Universität Rostock",       "Rostock",      "Mecklenburg-VP",     "U",  True,  0.80),
    ("OVGU Magdeburg",            "Magdeburg",    "Sachsen-Anhalt",     "U",  True,  0.82),
]


# ─── PROGRAMLAR ────────────────────────────────────────────────────────────────
# (program_adı, alan_grubu, derece, dil, almanca_şartı, ingilizce_şartı, nc, min_gpa,
#  deadline_wise, deadline_sose, açıklama_url_token)

PROGRAMS = [
    # ── Mühendislik ───────────────────────────────────────────────────────────
    # (program, alan, derece, dil, ger_req, eng_req, nc, min_gpa, dw, ds)
    ("Maschinenbau",                         "engineering",  "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),
    ("Maschinenbau",                         "engineering",  "Master",   "Deutsch",  "DSH-2",  None,          None,             2.5,  "15.01.", "15.07."),
    ("Mechanical Engineering",               "engineering",  "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Elektrotechnik",                       "engineering",  "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),
    ("Elektrotechnik",                       "engineering",  "Master",   "Deutsch",  "DSH-2",  None,          None,             2.5,  "15.01.", "15.07."),
    ("Electrical Engineering",               "engineering",  "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Informatik",                           "cs",           "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),
    ("Informatik",                           "cs",           "Master",   "Deutsch",  "DSH-2",  None,          None,             2.5,  "15.01.", "15.07."),
    ("Computer Science",                     "cs",           "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Software Engineering",                 "cs",           "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Wirtschaftsingenieurwesen",            "engineering",  "Bachelor", "Deutsch",  "DSH-2",  None,          "2.5",            None, "15.01.", "15.07."),
    ("Wirtschaftsingenieurwesen",            "engineering",  "Master",   "Deutsch",  "DSH-2",  None,          None,             2.5,  "15.01.", "15.07."),
    ("Industrial Engineering and Management","engineering",  "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Bauingenieurwesen",                    "civil",        "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),
    ("Bauingenieurwesen",                    "civil",        "Master",   "Deutsch",  "DSH-2",  None,          None,             2.5,  "15.01.", "15.07."),
    ("Civil Engineering",                    "civil",        "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Chemieingenieurwesen",                 "chemical",     "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),
    ("Chemical Engineering",                 "chemical",     "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Luft- und Raumfahrttechnik",           "aerospace",    "Bachelor", "Deutsch",  "DSH-2",  None,          "2.5",            None, "15.01.", None),
    ("Aerospace Engineering",                "aerospace",    "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", None),
    ("Umweltingenieurwesen",                 "environmental","Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),
    ("Environmental Engineering",            "environmental","Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Mechatronik",                          "mechatronics", "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),
    ("Mechatronics",                         "mechatronics", "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Energietechnik",                       "energy",       "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),
    ("Energy Engineering",                   "energy",       "Master",   "Englisch", None,     "IELTS 6.0",   None,             2.5,  "15.01.", "15.07."),
    ("Erneuerbare Energien",                 "energy",       "Master",   "Deutsch",  "DSH-2",  None,          None,             2.5,  "15.01.", "15.07."),
    ("Renewable Energy Engineering",         "energy",       "Master",   "Englisch", None,     "IELTS 6.0",   None,             2.5,  "15.01.", "15.07."),
    ("Produktionstechnik",                   "engineering",  "Master",   "Deutsch",  "DSH-2",  None,          None,             2.5,  "15.01.", "15.07."),
    ("Fahrzeugtechnik",                      "engineering",  "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),
    ("Automotive Engineering",               "engineering",  "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Biomedical Engineering",               "biomedical",   "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Medizintechnik",                       "biomedical",   "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),
    ("Materialwissenschaft",                 "materials",    "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),
    ("Materials Science and Engineering",    "materials",    "Master",   "Englisch", None,     "IELTS 6.0",   None,             2.5,  "15.01.", "15.07."),
    ("Technische Physik",                    "physics",      "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),
    ("Geoinformatik",                        "cs",           "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),

    # ── Bilgisayar Bilimi & Yapay Zeka ────────────────────────────────────────
    ("Artificial Intelligence",              "ai",           "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Machine Learning",                     "ai",           "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Data Science",                         "cs",           "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Datenwissenschaften",                  "cs",           "Master",   "Deutsch",  "DSH-2",  None,          None,             2.5,  "15.01.", "15.07."),
    ("IT-Sicherheit",                        "cs",           "Master",   "Deutsch",  "DSH-2",  None,          None,             2.5,  "15.01.", "15.07."),
    ("Cybersecurity",                        "cs",           "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Human-Computer Interaction",           "cs",           "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Medieninformatik",                     "cs",           "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),
    ("Wirtschaftsinformatik",                "cs",           "Bachelor", "Deutsch",  "DSH-2",  None,          "2.7",            None, "15.01.", "15.07."),
    ("Information Systems",                  "cs",           "Master",   "Englisch", None,     "IELTS 6.0",   None,             2.5,  "15.01.", "15.07."),
    ("Embedded Systems",                     "cs",           "Master",   "Englisch", None,     "IELTS 6.0",   None,             2.5,  "15.01.", "15.07."),
    ("Robotics",                             "cs",           "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Autonomous Systems",                   "cs",           "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),

    # ── Doğa Bilimleri ────────────────────────────────────────────────────────
    ("Physik",                               "physics",      "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),
    ("Physics",                              "physics",      "Master",   "Englisch", None,     "IELTS 6.0",   None,             2.5,  "15.01.", "15.07."),
    ("Chemie",                               "chemistry",    "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),
    ("Chemistry",                            "chemistry",    "Master",   "Englisch", None,     "IELTS 6.0",   None,             2.5,  "15.01.", "15.07."),
    ("Biologie",                             "biology",      "Bachelor", "Deutsch",  "DSH-2",  None,          "2.5",            None, "15.01.", "15.07."),
    ("Bioinformatik",                        "biology",      "Master",   "Deutsch",  "DSH-2",  None,          None,             2.5,  "15.01.", "15.07."),
    ("Bioinformatics",                       "biology",      "Master",   "Englisch", None,     "IELTS 6.0",   None,             2.5,  "15.01.", "15.07."),
    ("Mathematik",                           "math",         "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),
    ("Mathematics",                          "math",         "Master",   "Englisch", None,     "IELTS 6.0",   None,             2.5,  "15.01.", "15.07."),
    ("Statistik",                            "math",         "Master",   "Deutsch",  "DSH-2",  None,          None,             2.5,  "15.01.", "15.07."),
    ("Applied Mathematics",                  "math",         "Master",   "Englisch", None,     "IELTS 6.0",   None,             2.5,  "15.01.", "15.07."),
    ("Biotechnologie",                       "biotech",      "Bachelor", "Deutsch",  "DSH-2",  None,          "2.5",            None, "15.01.", "15.07."),
    ("Biotechnology",                        "biotech",      "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Geowissenschaften",                    "geo",          "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),
    ("Nanowissenschaften",                   "materials",    "Master",   "Deutsch",  "DSH-2",  None,          None,             2.5,  "15.01.", "15.07."),

    # ── İşletme & Ekonomi ────────────────────────────────────────────────────
    ("Betriebswirtschaftslehre (BWL)",       "business",     "Bachelor", "Deutsch",  "DSH-2",  None,          "2.0",            None, "15.01.", "15.07."),
    ("Business Administration",              "business",     "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Management",                           "business",     "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("MBA",                                  "business",     "Master",   "Englisch", None,     "IELTS 7.0",   None,             None, "01.03.", "01.09."),
    ("Volkswirtschaftslehre (VWL)",          "economics",    "Bachelor", "Deutsch",  "DSH-2",  None,          "2.5",            None, "15.01.", "15.07."),
    ("Economics",                            "economics",    "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Finance",                              "finance",      "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Finance and Accounting",               "finance",      "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("International Business",               "business",     "Bachelor", "Englisch", None,     "IELTS 6.0",   "2.8",            None, "15.01.", "15.07."),
    ("International Management",             "business",     "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Supply Chain Management",              "business",     "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Marketing",                            "business",     "Master",   "Deutsch",  "DSH-2",  None,          None,             2.5,  "15.01.", "15.07."),
    ("Entrepreneurship",                     "business",     "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Human Resource Management",            "business",     "Master",   "Englisch", None,     "IELTS 6.0",   None,             2.5,  "15.01.", "15.07."),

    # ── Sosyal Bilimler & İnsani Bilimler ─────────────────────────────────────
    ("Soziologie",                           "social",       "Bachelor", "Deutsch",  "DSH-2",  None,          "2.5",            None, "15.01.", "15.07."),
    ("Political Science",                    "social",       "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Politikwissenschaft",                  "social",       "Bachelor", "Deutsch",  "DSH-2",  None,          "2.5",            None, "15.01.", "15.07."),
    ("Kommunikationswissenschaft",           "social",       "Bachelor", "Deutsch",  "DSH-2",  None,          "2.5",            None, "15.01.", "15.07."),
    ("Psychology",                           "psychology",   "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Psychologie",                          "psychology",   "Bachelor", "Deutsch",  "DSH-2",  None,          "1.5",            None, "15.01.", None),
    ("Pädagogik",                            "education",    "Bachelor", "Deutsch",  "DSH-2",  None,          "2.5",            None, "15.01.", "15.07."),
    ("Educational Science",                  "education",    "Master",   "Englisch", None,     "IELTS 6.0",   None,             2.5,  "15.01.", "15.07."),
    ("Germanistik",                          "humanities",   "Bachelor", "Deutsch",  "DSH-2",  None,          "2.5",            None, "15.01.", "15.07."),
    ("Anglistik",                            "humanities",   "Bachelor", "Deutsch",  "DSH-2",  None,          "2.5",            None, "15.01.", "15.07."),
    ("Geschichte",                           "humanities",   "Bachelor", "Deutsch",  "DSH-2",  None,          "2.5",            None, "15.01.", "15.07."),
    ("Philosophie",                          "humanities",   "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),

    # ── Mimarlık & Kentsel Planlama ───────────────────────────────────────────
    ("Architektur",                          "architecture", "Bachelor", "Deutsch",  "DSH-2",  None,          "2.5",            None, "15.01.", None),
    ("Architecture",                         "architecture", "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", None),
    ("Stadtplanung",                         "urban",        "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),
    ("Urban Planning",                       "urban",        "Master",   "Englisch", None,     "IELTS 6.0",   None,             2.5,  "15.01.", "15.07."),
    ("Innenarchitektur",                     "architecture", "Bachelor", "Deutsch",  "DSH-2",  None,          "2.5",            None, "15.01.", None),
    ("Landschaftsarchitektur",               "architecture", "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),

    # ── Sağlık & Tıp ─────────────────────────────────────────────────────────
    ("Medizin",                              "medicine",     "Bachelor", "Deutsch",  "DSH-2",  None,          "1.0",            None, "15.01.", None),
    ("Zahnmedizin",                          "medicine",     "Bachelor", "Deutsch",  "DSH-2",  None,          "1.0",            None, "15.01.", None),
    ("Pharmazie",                            "pharmacy",     "Bachelor", "Deutsch",  "DSH-2",  None,          "1.5",            None, "15.01.", None),
    ("Gesundheitswissenschaften",            "health",       "Bachelor", "Deutsch",  "DSH-2",  None,          "2.5",            None, "15.01.", "15.07."),
    ("Public Health",                        "health",       "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Pflegewissenschaft",                   "health",       "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),

    # ── Hukuk ────────────────────────────────────────────────────────────────
    ("Rechtswissenschaft",                   "law",          "Bachelor", "Deutsch",  "DSH-2",  None,          "2.5",            None, "15.01.", "15.07."),
    ("German and European Law",              "law",          "Master",   "Englisch", "DSH-1",  "IELTS 6.5",   None,             2.5,  "01.03.", "01.09."),
    ("International Business Law",           "law",          "Master",   "Englisch", None,     "IELTS 7.0",   None,             2.5,  "01.03.", "01.09."),

    # ── Tasarım & Sanat ───────────────────────────────────────────────────────
    ("Industrial Design",                    "design",       "Bachelor", "Englisch", "DSH-1",  "IELTS 5.5",   None,             None, "15.01.", None),
    ("Kommunikationsdesign",                 "design",       "Bachelor", "Deutsch",  "DSH-2",  None,          "2.5",            None, "15.01.", None),
    ("Interaction Design",                   "design",       "Master",   "Englisch", None,     "IELTS 6.0",   None,             2.5,  "15.01.", None),
    ("Mediengestaltung",                     "design",       "Bachelor", "Deutsch",  "DSH-2",  None,          "2.5",            None, "15.01.", None),

    # ── Çevre & Sürdürülebilirlik ─────────────────────────────────────────────
    ("Sustainability Science",               "environmental","Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Nachhaltigkeitswissenschaften",        "environmental","Master",   "Deutsch",  "DSH-2",  None,          None,             2.5,  "15.01.", "15.07."),
    ("Umweltwissenschaften",                 "environmental","Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),
    ("Klimawissenschaften",                  "environmental","Master",   "Deutsch",  "DSH-2",  None,          None,             2.5,  "15.01.", "15.07."),

    # ── Fintech & Dijital ─────────────────────────────────────────────────────
    ("Digital Business",                     "business",     "Bachelor", "Englisch", None,     "IELTS 6.0",   "2.5",            None, "15.01.", "15.07."),
    ("Digital Transformation",               "business",     "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Financial Engineering",                "finance",      "Master",   "Englisch", None,     "IELTS 6.5",   None,             2.5,  "15.01.", "15.07."),
    ("Wirtschaftsmathematik",                "math",         "Bachelor", "Deutsch",  "DSH-2",  None,          "zulassungsfrei", None, "15.01.", "15.07."),
]


# ─── Üniversite türüne göre hangi programlar sunulur ─────────────────────────
# TU: Engineering ağırlıklı; FH: Applied ağırlıklı; U: Her alan

# TU'larda olmayan alanlar
TU_EXCLUDED = {"law", "medicine", "pharmacy", "humanities", "psychology", "education"}
# FH'lerde olmayan alanlar (teorik/araştırma ağırlıklı)
FH_EXCLUDED = {"medicine", "pharmacy", "law", "physics", "humanities", "math", "philosophy"}
# FH'lerde önerilen program türleri (genellikle Bachelor + Applied Master)
FH_PREFERRED_DEGREES = {"Bachelor", "Master"}

# FH'de hangi programlar olsun
FH_ALLOWED_FIELDS = {
    "engineering", "cs", "ai", "mechatronics", "energy", "automotive",
    "civil", "chemical", "aerospace", "environmental", "biomedical",
    "materials", "architecture", "urban", "design", "business", "economics",
    "finance", "health", "biotech", "social", "geo"
}


def make_url_token(uni_name: str, program: str, degree: str) -> str:
    """Sahte ama tutarlı URL oluştur."""
    uni_slug = (
        uni_name.lower()
        .replace("universität", "uni")
        .replace("hochschule", "hs")
        .replace("technische universität", "tu")
        .replace(" ", "-")
        .replace("(", "")
        .replace(")", "")
        .replace("/", "-")
        [:25]
    )
    prog_slug = program.lower().replace(" ", "-").replace("/", "-")[:20]
    return f"https://www.{uni_slug}.de/studium/{prog_slug}"


def seed(conn: sqlite3.Connection, clear: bool = False):
    if clear:
        conn.execute("DELETE FROM programs")
        print("⚠️  Veritabanı temizlendi.")

    inserted = 0
    skipped = 0

    for (uni_name, city, state, uni_type, uni_assist_req, base_conf) in UNIVERSITIES:
        for (prog, field, degree, lang, ger_req, eng_req, nc, min_gpa, dw, ds) in PROGRAMS:

            # Üniversite türüne göre filtrele
            if uni_type == "TU" and field in TU_EXCLUDED:
                continue
            if uni_type == "FH":
                if field in FH_EXCLUDED:
                    continue
                if field not in FH_ALLOWED_FIELDS:
                    continue
                # FH'lerde araştırma ağırlıklı master'lar genellikle yok
                if degree == "Master" and field in {"physics", "math", "chemistry", "humanities"}:
                    continue

            # Özel üniversitelerde İngilizce programlar daha yaygın → ek boost
            conf_boost = 0.0
            if uni_type == "U" and lang == "Englisch":
                conf_boost = 0.05
            if uni_type == "FH" and degree == "Bachelor":
                conf_boost = 0.03

            # URL
            url_hint = make_url_token(uni_name, prog, degree)
            pid = hashlib.md5(f"{uni_name}||{prog}||{degree}||{lang}".encode()).hexdigest()[:16]

            record = {
                "id":                    pid,
                "university":            uni_name,
                "program":               prog,
                "city":                  city,
                "language":              lang,
                "degree":                degree,
                "deadline_wise":         dw,
                "deadline_sose":         ds,
                "german_requirement":    ger_req,
                "english_requirement":   eng_req,
                "nc_value":              nc,
                "min_gpa":               min_gpa,
                "uni_assist":            int(uni_assist_req),
                "conditional_admission": 1,
                "url":                   None,   # Gerçek URL yok; scrape edildiğinde doldurulur
                "source":                "seed_db",
                "confidence":            round(min(base_conf + conf_boost, 0.95), 2),
                "last_scraped":          NOW,
                "updated_at":            NOW,
            }

            try:
                conn.execute("""
                    INSERT INTO programs
                        (id, university, program, city, language, degree,
                         deadline_wise, deadline_sose,
                         german_requirement, english_requirement,
                         nc_value, min_gpa, uni_assist, conditional_admission,
                         url, source, confidence, last_scraped, updated_at)
                    VALUES
                        (:id, :university, :program, :city, :language, :degree,
                         :deadline_wise, :deadline_sose,
                         :german_requirement, :english_requirement,
                         :nc_value, :min_gpa, :uni_assist, :conditional_admission,
                         :url, :source, :confidence, :last_scraped, :updated_at)
                    ON CONFLICT(id) DO UPDATE SET
                        university            = excluded.university,
                        program               = excluded.program,
                        city                  = excluded.city,
                        language              = excluded.language,
                        degree                = excluded.degree,
                        deadline_wise         = excluded.deadline_wise,
                        deadline_sose         = excluded.deadline_sose,
                        german_requirement    = excluded.german_requirement,
                        english_requirement   = excluded.english_requirement,
                        nc_value              = excluded.nc_value,
                        min_gpa               = excluded.min_gpa,
                        uni_assist            = excluded.uni_assist,
                        conditional_admission = excluded.conditional_admission,
                        source                = excluded.source,
                        confidence            = excluded.confidence,
                        last_scraped          = excluded.last_scraped,
                        updated_at            = excluded.updated_at
                """, record)
                inserted += 1
            except sqlite3.IntegrityError:
                skipped += 1

    conn.commit()
    return inserted, skipped


def print_stats(conn: sqlite3.Connection):
    total = conn.execute("SELECT COUNT(*) FROM programs").fetchone()[0]
    by_lang = conn.execute(
        "SELECT language, COUNT(*) cnt FROM programs GROUP BY language ORDER BY cnt DESC"
    ).fetchall()
    by_deg = conn.execute(
        "SELECT degree, COUNT(*) cnt FROM programs GROUP BY degree ORDER BY cnt DESC"
    ).fetchall()
    by_src = conn.execute(
        "SELECT source, COUNT(*) cnt FROM programs GROUP BY source ORDER BY cnt DESC"
    ).fetchall()
    top_unis = conn.execute(
        "SELECT university, COUNT(*) cnt FROM programs GROUP BY university ORDER BY cnt DESC LIMIT 10"
    ).fetchall()

    print(f"\n{'─'*50}")
    print(f"  Toplam kayıt   : {total:,}")
    print(f"\n  Dile göre:")
    for r in by_lang:
        print(f"    {r[0] or '(boş)':30} {r[1]:>5}")
    print(f"\n  Dereceye göre:")
    for r in by_deg:
        print(f"    {r[0] or '(boş)':20} {r[1]:>5}")
    print(f"\n  Kaynağa göre:")
    for r in by_src:
        print(f"    {r[0] or '(boş)':25} {r[1]:>5}")
    print(f"\n  En çok program içeren üniversiteler:")
    for r in top_unis:
        print(f"    {r[0]:45} {r[1]:>4}")
    print(f"{'─'*50}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AES DB Seed")
    parser.add_argument("--clear", action="store_true",
                        help="Önce mevcut seed kayıtlarını sil, sonra yeniden yükle")
    parser.add_argument("--stats", action="store_true",
                        help="Sadece istatistik göster, kayıt ekleme")
    args = parser.parse_args()

    conn = sqlite3.connect(str(DB_PATH))

    if args.stats:
        print_stats(conn)
        conn.close()
        sys.exit(0)

    print(f"📚 AES Veritabanı Seed — {DB_PATH}")
    print(f"   Üniversite: {len(UNIVERSITIES):,}  ×  Program: {len(PROGRAMS):,}")
    print("   Yükleniyor...", end="", flush=True)

    ins, skp = seed(conn, clear=args.clear)
    print(f" Bitti!\n")
    print(f"   ✅ Eklenen/güncellenen : {ins:,}")
    print(f"   ⏭  Atlanan (çakışma)  : {skp:,}")

    print_stats(conn)
    conn.close()
