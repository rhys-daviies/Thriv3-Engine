/**
 * Real operator-evidence payloads, captured from the running endpoint.
 *
 * Not hand-written. The six states this surface has to tell apart are all real
 * situations in the production database — Jacksonville has a grouped roster
 * reason and a grouped pathway reason, Bethesda is a programme we hold and
 * know nothing about, and "Nowhere At All" is a name that does not resolve —
 * and a fixture invented to match the code would only prove the code matches
 * itself.
 */
export const FIXTURES = {
  "Jacksonville": {
    "programme": {
      "resolved": true
    },
    "summary": {
      "reasonCount": 4,
      "hasPositiveReasons": true,
      "openingIdentified": true,
      "hasEvidence": true,
      "evidenceCount": 19,
      "sectionCounts": {
        "ROSTER_OPPORTUNITY": 5,
        "RECRUITMENT_PATHWAY": 7,
        "DEVELOPMENT": 4,
        "ACADEMIC_PROGRAMME_FIT": 2,
        "PROGRAMME_CONTEXT": 1
      }
    },
    "topReasons": [
      {
        "primary": {
          "kind": "POSITION_GRADUATION",
          "decisionClass": "OPENING",
          "polarity": "POSITIVE",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "count": 3,
            "names": [
              "Nahne Paulsen",
              "Simon Libert",
              "Nassim Akki"
            ],
            "beforeClassYear": 2027
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "CURRENT",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
            },
            "season": "2026",
            "source": "roster_players",
            "sourceUrl": null,
            "window": null,
            "comparison": null
          }
        },
        "supporting": [
          {
            "kind": "POSITION_GRADUATION_STARTERS",
            "decisionClass": "OPENING",
            "polarity": "POSITIVE",
            "category": "roster",
            "facts": {
              "position": "DEFENSE",
              "starterCount": 2,
              "names": [
                "Nahne Paulsen",
                "Simon Libert"
              ],
              "basis": "projected"
            },
            "qualification": {
              "tier": "SIGNAL",
              "temporality": "PROJECTED",
              "confidence": "MEDIUM",
              "confidenceBeforeFreshness": null,
              "freshness": {
                "state": "CURRENT",
                "ageDays": 7,
                "reason": null
              },
              "season": "2026",
              "source": "roster_players:projected_minutes",
              "sourceUrl": null,
              "window": null,
              "comparison": null
            }
          },
          {
            "kind": "ELIGIBILITY_CLIFF",
            "decisionClass": "OPENING",
            "polarity": "POSITIVE",
            "category": "roster",
            "facts": {
              "position": "DEFENSE",
              "players": 5,
              "projectedMinutes": 3114,
              "beforeClassYear": 2027,
              "byYear": [
                {
                  "year": 2026,
                  "minutes": 2243,
                  "players": 3
                },
                {
                  "year": 2027,
                  "minutes": 871,
                  "players": 2
                }
              ]
            },
            "qualification": {
              "tier": "SIGNAL",
              "temporality": "PROJECTED",
              "confidence": "MEDIUM",
              "confidenceBeforeFreshness": null,
              "freshness": {
                "state": "CURRENT",
                "ageDays": 7,
                "reason": null
              },
              "season": "2026",
              "source": "roster_players:eligibility_end_year",
              "sourceUrl": null,
              "window": null,
              "comparison": null
            }
          }
        ],
        "decisionClass": "OPENING",
        "category": "roster",
        "dedupeGroup": "position-opportunity",
        "section": "ROSTER_OPPORTUNITY"
      },
      {
        "primary": {
          "kind": "COACH_ARRIVAL_SAME_COUNTRY",
          "decisionClass": "PATHWAY",
          "polarity": "POSITIVE",
          "category": "international",
          "facts": {
            "country": "New Zealand",
            "coach": "Ali Simmons",
            "position": null,
            "count": 1,
            "seasons": [
              "2025"
            ],
            "namedArrival": "Hayden Aish",
            "namedArrivalSeason": "2025",
            "attributableIntakes": 3,
            "intakesWithArrival": 1,
            "arrivals": [
              {
                "player": "Hayden Aish",
                "season": "2025",
                "country": "New Zealand",
                "region": "OCEANIA",
                "position": "MIDFIELD",
                "coach": "Ali Simmons",
                "coachAttribution": "ATTRIBUTED"
              }
            ]
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
            },
            "season": "2025",
            "source": "recruiting_arrivals",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2024",
                "2025",
                "2026"
              ],
              "seasonsUnread": [],
              "n": 1,
              "cohort": {
                "country": "New Zealand",
                "coach": "Ali Simmons",
                "position": null
              }
            },
            "comparison": null
          }
        },
        "supporting": [
          {
            "kind": "ARRIVAL_SAME_REGION_POSITION",
            "decisionClass": "PATHWAY",
            "polarity": "POSITIVE",
            "category": "international",
            "facts": {
              "region": "OCEANIA",
              "countries": [
                "Australia"
              ],
              "position": "DEFENSE",
              "count": 1,
              "seasons": [
                "2026"
              ],
              "namedArrival": "Liam Buckley",
              "namedArrivalSeason": "2026",
              "observedIntakes": 4,
              "arrivals": [
                {
                  "player": "Liam Buckley",
                  "season": "2026",
                  "country": "Australia",
                  "region": "OCEANIA",
                  "position": "DEFENSE",
                  "coach": "Ali Simmons",
                  "coachAttribution": "ATTRIBUTED"
                }
              ]
            },
            "qualification": {
              "tier": "FACT",
              "temporality": "HISTORICAL",
              "confidence": "HIGH",
              "confidenceBeforeFreshness": null,
              "freshness": {
                "state": "CURRENT",
                "ageDays": 7,
                "reason": null
              },
              "season": "2026",
              "source": "recruiting_arrivals",
              "sourceUrl": null,
              "window": {
                "seasons": [
                  "2023",
                  "2024",
                  "2025",
                  "2026"
                ],
                "seasonsUnread": [],
                "n": 1,
                "cohort": {
                  "region": "OCEANIA",
                  "excludingCountry": "New Zealand",
                  "position": "DEFENSE"
                }
              },
              "comparison": null
            }
          },
          {
            "kind": "HISTORICAL_SAME_COUNTRY",
            "decisionClass": "PATHWAY",
            "polarity": "POSITIVE",
            "category": "international",
            "facts": {
              "country": "New Zealand",
              "count": 1,
              "names": [
                "Hayden Aish"
              ],
              "seasonsPresent": [
                "2025"
              ]
            },
            "qualification": {
              "tier": "FACT",
              "temporality": "HISTORICAL",
              "confidence": "HIGH",
              "confidenceBeforeFreshness": null,
              "freshness": {
                "state": "CURRENT",
                "ageDays": 7,
                "reason": null
              },
              "season": "2025",
              "source": "roster_players",
              "sourceUrl": null,
              "window": {
                "seasons": [
                  "2022",
                  "2023",
                  "2024",
                  "2025",
                  "2026"
                ],
                "seasonsUnread": [],
                "n": 1,
                "cohort": {
                  "country": "New Zealand"
                }
              },
              "comparison": null
            }
          }
        ],
        "decisionClass": "PATHWAY",
        "category": "international",
        "dedupeGroup": "international-connection",
        "section": "RECRUITMENT_PATHWAY"
      },
      {
        "primary": {
          "kind": "ACADEMIC_FIT",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "academic",
          "facts": {
            "matchedProgramme": "Kinesiology",
            "statedByAthlete": "exercise science"
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "STATIC",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
            },
            "season": null,
            "source": "colleges:notable_majors",
            "sourceUrl": null,
            "window": null,
            "comparison": null
          }
        },
        "supporting": [],
        "decisionClass": "FIT",
        "category": "academic",
        "dedupeGroup": "academic",
        "section": "ACADEMIC_PROGRAMME_FIT"
      },
      {
        "primary": {
          "kind": "PROGRAM_MOMENTUM",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "classification": "RISING",
            "recentWinPct": 0.4,
            "priorWinPct": 0.32
          },
          "qualification": {
            "tier": "SIGNAL",
            "temporality": "STATIC",
            "confidence": "MEDIUM",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
            },
            "season": "recent vs prior two seasons",
            "source": "colleges:recent_win_pct",
            "sourceUrl": null,
            "window": null,
            "comparison": null
          }
        },
        "supporting": [],
        "decisionClass": "FIT",
        "category": "performance",
        "dedupeGroup": "programme-success",
        "section": "ACADEMIC_PROGRAMME_FIT"
      }
    ],
    "sections": {
      "ROSTER_OPPORTUNITY": [
        {
          "kind": "POSITION_GRADUATION",
          "decisionClass": "OPENING",
          "polarity": "POSITIVE",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "count": 3,
            "names": [
              "Nahne Paulsen",
              "Simon Libert",
              "Nassim Akki"
            ],
            "beforeClassYear": 2027
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "CURRENT",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
            },
            "season": "2026",
            "source": "roster_players",
            "sourceUrl": null,
            "window": null,
            "comparison": null
          }
        },
        {
          "kind": "POSITION_GRADUATION_STARTERS",
          "decisionClass": "OPENING",
          "polarity": "POSITIVE",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "starterCount": 2,
            "names": [
              "Nahne Paulsen",
              "Simon Libert"
            ],
            "basis": "projected"
          },
          "qualification": {
            "tier": "SIGNAL",
            "temporality": "PROJECTED",
            "confidence": "MEDIUM",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
            },
            "season": "2026",
            "source": "roster_players:projected_minutes",
            "sourceUrl": null,
            "window": null,
            "comparison": null
          }
        },
        {
          "kind": "ELIGIBILITY_CLIFF",
          "decisionClass": "OPENING",
          "polarity": "POSITIVE",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "players": 5,
            "projectedMinutes": 3114,
            "beforeClassYear": 2027,
            "byYear": [
              {
                "year": 2026,
                "minutes": 2243,
                "players": 3
              },
              {
                "year": 2027,
                "minutes": 871,
                "players": 2
              }
            ]
          },
          "qualification": {
            "tier": "SIGNAL",
            "temporality": "PROJECTED",
            "confidence": "MEDIUM",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
            },
            "season": "2026",
            "source": "roster_players:eligibility_end_year",
            "sourceUrl": null,
            "window": null,
            "comparison": null
          }
        },
        {
          "kind": "POSITION_GROUP_SIZE",
          "decisionClass": "CONTEXT",
          "polarity": "NEUTRAL",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "count": 9,
            "squadSize": 29
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "CURRENT",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
            },
            "season": "2026",
            "source": "roster_players",
            "sourceUrl": null,
            "window": null,
            "comparison": null
          }
        },
        {
          "kind": "SQUAD_GRADUATION",
          "decisionClass": "CONTEXT",
          "polarity": "POSITIVE",
          "category": "roster",
          "facts": {
            "total": 6,
            "starters": 3,
            "names": [
              "Nahne Paulsen",
              "Simon Libert",
              "Nassim Akki",
              "Romain Spailier",
              "Kilian Krug",
              "Hunter Outerbridge"
            ],
            "beforeClassYear": 2027
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "CURRENT",
            "confidence": "MEDIUM",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
            },
            "season": "2026",
            "source": "roster_players",
            "sourceUrl": null,
            "window": null,
            "comparison": null
          }
        }
      ],
      "RECRUITMENT_PATHWAY": [
        {
          "kind": "COACH_ARRIVAL_SAME_COUNTRY",
          "decisionClass": "PATHWAY",
          "polarity": "POSITIVE",
          "category": "international",
          "facts": {
            "country": "New Zealand",
            "coach": "Ali Simmons",
            "position": null,
            "count": 1,
            "seasons": [
              "2025"
            ],
            "namedArrival": "Hayden Aish",
            "namedArrivalSeason": "2025",
            "attributableIntakes": 3,
            "intakesWithArrival": 1,
            "arrivals": [
              {
                "player": "Hayden Aish",
                "season": "2025",
                "country": "New Zealand",
                "region": "OCEANIA",
                "position": "MIDFIELD",
                "coach": "Ali Simmons",
                "coachAttribution": "ATTRIBUTED"
              }
            ]
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
            },
            "season": "2025",
            "source": "recruiting_arrivals",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2024",
                "2025",
                "2026"
              ],
              "seasonsUnread": [],
              "n": 1,
              "cohort": {
                "country": "New Zealand",
                "coach": "Ali Simmons",
                "position": null
              }
            },
            "comparison": null
          }
        },
        {
          "kind": "ARRIVAL_SAME_REGION_POSITION",
          "decisionClass": "PATHWAY",
          "polarity": "POSITIVE",
          "category": "international",
          "facts": {
            "region": "OCEANIA",
            "countries": [
              "Australia"
            ],
            "position": "DEFENSE",
            "count": 1,
            "seasons": [
              "2026"
            ],
            "namedArrival": "Liam Buckley",
            "namedArrivalSeason": "2026",
            "observedIntakes": 4,
            "arrivals": [
              {
                "player": "Liam Buckley",
                "season": "2026",
                "country": "Australia",
                "region": "OCEANIA",
                "position": "DEFENSE",
                "coach": "Ali Simmons",
                "coachAttribution": "ATTRIBUTED"
              }
            ]
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
            },
            "season": "2026",
            "source": "recruiting_arrivals",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2023",
                "2024",
                "2025",
                "2026"
              ],
              "seasonsUnread": [],
              "n": 1,
              "cohort": {
                "region": "OCEANIA",
                "excludingCountry": "New Zealand",
                "position": "DEFENSE"
              }
            },
            "comparison": null
          }
        },
        {
          "kind": "HISTORICAL_SAME_COUNTRY",
          "decisionClass": "PATHWAY",
          "polarity": "POSITIVE",
          "category": "international",
          "facts": {
            "country": "New Zealand",
            "count": 1,
            "names": [
              "Hayden Aish"
            ],
            "seasonsPresent": [
              "2025"
            ]
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
            },
            "season": "2025",
            "source": "roster_players",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2023",
                "2024",
                "2025",
                "2026"
              ],
              "seasonsUnread": [],
              "n": 1,
              "cohort": {
                "country": "New Zealand"
              }
            },
            "comparison": null
          }
        },
        {
          "kind": "POSITION_INTAKE_HISTORY",
          "decisionClass": "CONTEXT",
          "polarity": "NEUTRAL",
          "category": "internal",
          "facts": {
            "position": "DEFENSE",
            "count": 19,
            "seasons": [
              "2023",
              "2024",
              "2025",
              "2026"
            ],
            "observedIntakes": 4,
            "intakesWithArrival": 4,
            "meanPerIntake": 4.75,
            "byIntake": {
              "2022->2023": 4,
              "2023->2024": 5,
              "2024->2025": 5,
              "2025->2026": 5
            }
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": null,
            "season": "2023-2026",
            "source": "recruiting_arrivals",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2023",
                "2024",
                "2025",
                "2026"
              ],
              "seasonsUnread": [],
              "n": 19,
              "cohort": {
                "position": "DEFENSE"
              }
            },
            "comparison": null
          }
        },
        {
          "kind": "TRANSFER_BEHAVIOUR",
          "decisionClass": "CONTEXT",
          "polarity": "NEUTRAL",
          "category": "internal",
          "facts": {
            "arrivals": 5,
            "atPosition": 2,
            "squadSize": 29
          },
          "qualification": {
            "tier": "SIGNAL",
            "temporality": "CURRENT",
            "confidence": "MEDIUM",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
            },
            "season": "2026",
            "source": "roster_players:prior_programme",
            "sourceUrl": null,
            "window": null,
            "comparison": null
          }
        },
        {
          "kind": "INTERNATIONAL_ROSTER",
          "decisionClass": "CONTEXT",
          "polarity": "POSITIVE",
          "category": "international",
          "facts": {
            "count": 19,
            "countries": [
              "Australia",
              "Belgium",
              "Bermuda",
              "Canada",
              "France",
              "Germany",
              "Norway",
              "Peru"
            ],
            "uniqueCountries": 8
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "CURRENT",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
            },
            "season": "2026",
            "source": "roster_players",
            "sourceUrl": null,
            "window": null,
            "comparison": null
          }
        },
        {
          "kind": "INTERNATIONAL_SHARE",
          "decisionClass": "CONTEXT",
          "polarity": "POSITIVE",
          "category": "international",
          "facts": {
            "count": 19,
            "squadSize": 29,
            "share": 0.66
          },
          "qualification": {
            "tier": "SIGNAL",
            "temporality": "CURRENT",
            "confidence": "MEDIUM",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
            },
            "season": "2026",
            "source": "roster_players",
            "sourceUrl": null,
            "window": null,
            "comparison": null
          }
        }
      ],
      "DEVELOPMENT": [
        {
          "kind": "ATHLETE_COHORT_LADDER",
          "decisionClass": "PATHWAY",
          "polarity": "NEUTRAL",
          "category": "development",
          "facts": {
            "ladder": [
              {
                "rank": 1,
                "median": 532,
                "low": 0,
                "high": 717,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 233,
                "low": 208,
                "high": 464,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 3,
                "median": 100,
                "low": 0,
                "high": 316,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 4,
                "median": 0,
                "low": 0,
                "high": 0,
                "band": "none",
                "agreement": "tight",
                "seasonsWithThisMany": 2
              }
            ],
            "cohort": {
              "position": null,
              "origin": "international",
              "applied": true
            },
            "asked": {
              "position": "DEFENSE",
              "origin": "international"
            },
            "refused": "DEFENSE / international: only 1 in 1 season — too few to read separately",
            "relaxed": "international",
            "players": 12,
            "seasonsObserved": 4
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "MEDIUM",
            "confidenceBeforeFreshness": null,
            "freshness": null,
            "season": "2022, 2023, 2024, 2025",
            "source": "roster_players:freshman-minutes",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2023",
                "2024",
                "2025"
              ],
              "seasonsUnread": null,
              "n": 12,
              "cohort": {
                "position": null,
                "origin": "international"
              }
            },
            "comparison": null
          }
        },
        {
          "kind": "PROGRAMME_DEVELOPMENT_PATTERN",
          "decisionClass": "FIT",
          "polarity": "NEUTRAL",
          "category": "development",
          "facts": {
            "verdictKey": "continuity-through-change",
            "verdictNote": "the coach changed but the pattern did not — this looks structural, so every season counts",
            "seasonsObserved": 4,
            "players": 24,
            "shareBySeason": [
              {
                "season": "2022",
                "shareOfSquadMinutes": 0.17384909545521401,
                "intake": 8,
                "measured": 8
              },
              {
                "season": "2023",
                "shareOfSquadMinutes": 0.05993312724749227,
                "intake": 7,
                "measured": 7
              },
              {
                "season": "2024",
                "shareOfSquadMinutes": 0,
                "intake": 1,
                "measured": 1
              },
              {
                "season": "2025",
                "shareOfSquadMinutes": 0.19853390348197922,
                "intake": 8,
                "measured": 8
              }
            ],
            "minuteShares": {
              "n": 8,
              "freshman": 10.8,
              "newcomer": 47.5,
              "returning": 41.7
            },
            "spread": 8.140468402404561,
            "step": -7.458214371422441,
            "coach": "Ali Simmons",
            "coachStillInPost": true
          },
          "qualification": {
            "tier": "SIGNAL",
            "temporality": "HISTORICAL",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": null,
            "season": "2022, 2023, 2024, 2025",
            "source": "roster_players:freshman-minutes",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2023",
                "2024",
                "2025"
              ],
              "seasonsUnread": [],
              "n": 4,
              "cohort": null
            },
            "comparison": null
          }
        },
        {
          "kind": "FRESHMAN_MINUTES_LADDER",
          "decisionClass": "FIT",
          "polarity": "NEUTRAL",
          "category": "development",
          "facts": {
            "ladder": [
              {
                "rank": 1,
                "median": 827,
                "low": 0,
                "high": 1289,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 603,
                "low": 233,
                "high": 628,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 3,
                "median": 450,
                "low": 0,
                "high": 613,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 4,
                "median": 208,
                "low": 0,
                "high": 464,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 5,
                "median": 100,
                "low": 0,
                "high": 316,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 6,
                "median": 66,
                "low": 0,
                "high": 265,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 3
              }
            ],
            "seasonsObserved": 4,
            "medianIntake": 8,
            "medianPlayed": 4,
            "seasonsWithAnImpactFreshman": 3
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": null,
            "season": "2022, 2023, 2024, 2025",
            "source": "roster_players:freshman-minutes",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2023",
                "2024",
                "2025"
              ],
              "seasonsUnread": [],
              "n": 24,
              "cohort": null
            },
            "comparison": null
          }
        },
        {
          "kind": "PROGRAMME_POOL_BENCHMARK",
          "decisionClass": "CONTEXT",
          "polarity": "NEUTRAL",
          "category": "development",
          "facts": {
            "rank": 1,
            "programmeMedian": 827,
            "programmeSpread": {
              "low": 0,
              "high": 1289,
              "agreement": "tight"
            },
            "pool": {
              "n": 770,
              "p25": 901,
              "median": 1118,
              "p75": 1289
            },
            "band": "at-or-below-p25"
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": null,
            "season": "2022, 2023, 2024, 2025",
            "source": "roster_players:pool-benchmarks",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2023",
                "2024",
                "2025"
              ],
              "seasonsUnread": [],
              "n": 24,
              "cohort": null
            },
            "comparison": {
              "basis": "mens-soccer programmes with a readable freshman ladder, 2022-2023-2024-2025",
              "statistic": "ladder-rank-1-median-minutes",
              "poolSize": 920,
              "percentile": null,
              "band": "at-or-below-p25"
            }
          }
        }
      ],
      "ACADEMIC_PROGRAMME_FIT": [
        {
          "kind": "ACADEMIC_FIT",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "academic",
          "facts": {
            "matchedProgramme": "Kinesiology",
            "statedByAthlete": "exercise science"
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "STATIC",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
            },
            "season": null,
            "source": "colleges:notable_majors",
            "sourceUrl": null,
            "window": null,
            "comparison": null
          }
        },
        {
          "kind": "PROGRAM_MOMENTUM",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "classification": "RISING",
            "recentWinPct": 0.4,
            "priorWinPct": 0.32
          },
          "qualification": {
            "tier": "SIGNAL",
            "temporality": "STATIC",
            "confidence": "MEDIUM",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
            },
            "season": "recent vs prior two seasons",
            "source": "colleges:recent_win_pct",
            "sourceUrl": null,
            "window": null,
            "comparison": null
          }
        }
      ],
      "PROGRAMME_CONTEXT": [
        {
          "kind": "COACH_CONTEXT",
          "decisionClass": "CONTEXT",
          "polarity": "NEUTRAL",
          "category": "coach",
          "facts": {
            "coach": "Ali Simmons",
            "seasonsObserved": 4,
            "since": 2023,
            "windowBounded": false,
            "knownThrough": 2026,
            "stillInPost": true,
            "context": "ESTABLISHED"
          },
          "qualification": {
            "tier": "SIGNAL",
            "temporality": "STATIC",
            "confidence": "MEDIUM",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
            },
            "season": "2023-2026",
            "source": "coach_seasons",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2023",
                "2024",
                "2025",
                "2026"
              ],
              "seasonsUnread": [],
              "n": 4,
              "cohort": {
                "coach": "Ali Simmons"
              }
            },
            "comparison": null
          }
        }
      ]
    }
  },
  "George Mason": {
    "programme": {
      "resolved": true
    },
    "summary": {
      "reasonCount": 1,
      "hasPositiveReasons": true,
      "openingIdentified": false,
      "hasEvidence": true,
      "evidenceCount": 1,
      "sectionCounts": {
        "ROSTER_OPPORTUNITY": 0,
        "RECRUITMENT_PATHWAY": 0,
        "DEVELOPMENT": 0,
        "ACADEMIC_PROGRAMME_FIT": 1,
        "PROGRAMME_CONTEXT": 0
      }
    },
    "topReasons": [
      {
        "primary": {
          "kind": "PROGRAM_MOMENTUM",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "classification": "RISING",
            "recentWinPct": 0.63,
            "priorWinPct": 0.29
          },
          "qualification": {
            "tier": "SIGNAL",
            "temporality": "STATIC",
            "confidence": "MEDIUM",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "UNKNOWN",
              "ageDays": null,
              "reason": "no scrape date on these roster rows"
            },
            "season": "recent vs prior two seasons",
            "source": "colleges:recent_win_pct",
            "sourceUrl": null,
            "window": null,
            "comparison": null
          }
        },
        "supporting": [],
        "decisionClass": "FIT",
        "category": "performance",
        "dedupeGroup": "programme-success",
        "section": "ACADEMIC_PROGRAMME_FIT"
      }
    ],
    "sections": {
      "ROSTER_OPPORTUNITY": [],
      "RECRUITMENT_PATHWAY": [],
      "DEVELOPMENT": [],
      "ACADEMIC_PROGRAMME_FIT": [
        {
          "kind": "PROGRAM_MOMENTUM",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "classification": "RISING",
            "recentWinPct": 0.63,
            "priorWinPct": 0.29
          },
          "qualification": {
            "tier": "SIGNAL",
            "temporality": "STATIC",
            "confidence": "MEDIUM",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "UNKNOWN",
              "ageDays": null,
              "reason": "no scrape date on these roster rows"
            },
            "season": "recent vs prior two seasons",
            "source": "colleges:recent_win_pct",
            "sourceUrl": null,
            "window": null,
            "comparison": null
          }
        }
      ],
      "PROGRAMME_CONTEXT": []
    }
  },
  "Bethesda": {
    "programme": {
      "resolved": true
    },
    "summary": {
      "reasonCount": 0,
      "hasPositiveReasons": false,
      "openingIdentified": false,
      "hasEvidence": false,
      "evidenceCount": 0,
      "sectionCounts": {
        "ROSTER_OPPORTUNITY": 0,
        "RECRUITMENT_PATHWAY": 0,
        "DEVELOPMENT": 0,
        "ACADEMIC_PROGRAMME_FIT": 0,
        "PROGRAMME_CONTEXT": 0
      }
    },
    "topReasons": [],
    "sections": {
      "ROSTER_OPPORTUNITY": [],
      "RECRUITMENT_PATHWAY": [],
      "DEVELOPMENT": [],
      "ACADEMIC_PROGRAMME_FIT": [],
      "PROGRAMME_CONTEXT": []
    }
  },
  "Nowhere At All": {
    "programme": {
      "resolved": false
    },
    "summary": {
      "reasonCount": 0,
      "hasPositiveReasons": false,
      "openingIdentified": false,
      "hasEvidence": false,
      "evidenceCount": 0,
      "sectionCounts": {
        "ROSTER_OPPORTUNITY": 0,
        "RECRUITMENT_PATHWAY": 0,
        "DEVELOPMENT": 0,
        "ACADEMIC_PROGRAMME_FIT": 0,
        "PROGRAMME_CONTEXT": 0
      }
    },
    "topReasons": [],
    "sections": {
      "ROSTER_OPPORTUNITY": [],
      "RECRUITMENT_PATHWAY": [],
      "DEVELOPMENT": [],
      "ACADEMIC_PROGRAMME_FIT": [],
      "PROGRAMME_CONTEXT": []
    }
  },
  "Hamilton (Ryan)": {
    "programme": {
      "resolved": true
    },
    "summary": {
      "reasonCount": 0,
      "hasPositiveReasons": false,
      "openingIdentified": false,
      "hasEvidence": true,
      "evidenceCount": 2,
      "sectionCounts": {
        "ROSTER_OPPORTUNITY": 0,
        "RECRUITMENT_PATHWAY": 1,
        "DEVELOPMENT": 0,
        "ACADEMIC_PROGRAMME_FIT": 0,
        "PROGRAMME_CONTEXT": 1
      }
    },
    "topReasons": [],
    "sections": {
      "ROSTER_OPPORTUNITY": [],
      "RECRUITMENT_PATHWAY": [
        {
          "kind": "POSITION_INTAKE_HISTORY",
          "decisionClass": "CONTEXT",
          "polarity": "NEUTRAL",
          "category": "internal",
          "facts": {
            "position": "DEFENSE",
            "count": 8,
            "seasons": [
              "2023",
              "2024",
              "2025"
            ],
            "observedIntakes": 3,
            "intakesWithArrival": 3,
            "meanPerIntake": 2.6666666666666665,
            "byIntake": {
              "2022->2023": 2,
              "2023->2024": 1,
              "2024->2025": 5
            }
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": null,
            "season": "2023-2025",
            "source": "recruiting_arrivals",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2023",
                "2024",
                "2025"
              ],
              "seasonsUnread": [],
              "n": 8,
              "cohort": {
                "position": "DEFENSE"
              }
            },
            "comparison": null
          }
        }
      ],
      "DEVELOPMENT": [],
      "ACADEMIC_PROGRAMME_FIT": [],
      "PROGRAMME_CONTEXT": [
        {
          "kind": "COACH_CONTEXT",
          "decisionClass": "CONTEXT",
          "polarity": "NEUTRAL",
          "category": "coach",
          "facts": {
            "coach": "Brendan Ujvary",
            "seasonsObserved": 2,
            "since": 2025,
            "windowBounded": false,
            "knownThrough": 2026,
            "stillInPost": true,
            "context": "NEW"
          },
          "qualification": {
            "tier": "SIGNAL",
            "temporality": "STATIC",
            "confidence": "MEDIUM",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "UNKNOWN",
              "ageDays": null,
              "reason": "no scrape date on these roster rows"
            },
            "season": "2025-2026",
            "source": "coach_seasons",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2023",
                "2024",
                "2025",
                "2026"
              ],
              "seasonsUnread": [],
              "n": 2,
              "cohort": {
                "coach": "Brendan Ujvary"
              }
            },
            "comparison": null
          }
        }
      ]
    }
  },
  "Carleton (Ryan)": {
    "programme": {
      "resolved": true
    },
    "summary": {
      "reasonCount": 0,
      "hasPositiveReasons": false,
      "openingIdentified": false,
      "hasEvidence": true,
      "evidenceCount": 6,
      "sectionCounts": {
        "ROSTER_OPPORTUNITY": 0,
        "RECRUITMENT_PATHWAY": 1,
        "DEVELOPMENT": 4,
        "ACADEMIC_PROGRAMME_FIT": 0,
        "PROGRAMME_CONTEXT": 1
      }
    },
    "topReasons": [],
    "sections": {
      "ROSTER_OPPORTUNITY": [],
      "RECRUITMENT_PATHWAY": [
        {
          "kind": "POSITION_INTAKE_HISTORY",
          "decisionClass": "CONTEXT",
          "polarity": "NEUTRAL",
          "category": "internal",
          "facts": {
            "position": "DEFENSE",
            "count": 8,
            "seasons": [
              "2023",
              "2024",
              "2025"
            ],
            "observedIntakes": 3,
            "intakesWithArrival": 3,
            "meanPerIntake": 2.6666666666666665,
            "byIntake": {
              "2022->2023": 4,
              "2023->2024": 2,
              "2024->2025": 2
            }
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": null,
            "season": "2023-2025",
            "source": "recruiting_arrivals",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2023",
                "2024",
                "2025"
              ],
              "seasonsUnread": [],
              "n": 8,
              "cohort": {
                "position": "DEFENSE"
              }
            },
            "comparison": null
          }
        }
      ],
      "DEVELOPMENT": [
        {
          "kind": "ATHLETE_COHORT_LADDER",
          "decisionClass": "PATHWAY",
          "polarity": "NEUTRAL",
          "category": "development",
          "facts": {
            "ladder": [
              {
                "rank": 1,
                "median": 1472,
                "low": 1107,
                "high": 1610,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 160,
                "low": 35,
                "high": 1034,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 3,
                "median": 9,
                "low": 0,
                "high": 18,
                "band": "fringe",
                "agreement": "tight",
                "seasonsWithThisMany": 2
              },
              {
                "rank": 4,
                "median": 0,
                "low": 0,
                "high": 0,
                "band": "none",
                "agreement": "tight",
                "seasonsWithThisMany": 1
              }
            ],
            "cohort": {
              "position": "DEFENSE",
              "origin": null,
              "applied": true
            },
            "asked": {
              "position": "DEFENSE",
              "origin": "international"
            },
            "refused": "DEFENSE / international: only 0 in 0 seasons — too few to read separately",
            "relaxed": "DEFENSE",
            "players": 11,
            "seasonsObserved": 4
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "MEDIUM",
            "confidenceBeforeFreshness": null,
            "freshness": null,
            "season": "2022, 2023, 2024, 2025",
            "source": "roster_players:freshman-minutes",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2023",
                "2024",
                "2025"
              ],
              "seasonsUnread": null,
              "n": 11,
              "cohort": {
                "position": "DEFENSE",
                "origin": null
              }
            },
            "comparison": null
          }
        },
        {
          "kind": "PROGRAMME_DEVELOPMENT_PATTERN",
          "decisionClass": "FIT",
          "polarity": "NEUTRAL",
          "category": "development",
          "facts": {
            "verdictKey": "steady",
            "verdictNote": "one coach, a consistent pattern — every season counts and the record is as firm as this gets",
            "seasonsObserved": 4,
            "players": 32,
            "shareBySeason": [
              {
                "season": "2022",
                "shareOfSquadMinutes": 0.29822685054883197,
                "intake": 8,
                "measured": 8
              },
              {
                "season": "2023",
                "shareOfSquadMinutes": 0.11127189262012874,
                "intake": 9,
                "measured": 9
              },
              {
                "season": "2024",
                "shareOfSquadMinutes": 0.23272157338591434,
                "intake": 8,
                "measured": 8
              },
              {
                "season": "2025",
                "shareOfSquadMinutes": 0.21799595863544513,
                "intake": 7,
                "measured": 7
              }
            ],
            "minuteShares": {
              "n": 12,
              "freshman": 13.7,
              "newcomer": 0.3,
              "returning": 86
            },
            "spread": 6.709926816025246,
            "step": 2.06093944261994,
            "coach": "Bob Carlson",
            "coachStillInPost": true
          },
          "qualification": {
            "tier": "SIGNAL",
            "temporality": "HISTORICAL",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": null,
            "season": "2022, 2023, 2024, 2025",
            "source": "roster_players:freshman-minutes",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2023",
                "2024",
                "2025"
              ],
              "seasonsUnread": [],
              "n": 4,
              "cohort": null
            },
            "comparison": null
          }
        },
        {
          "kind": "FRESHMAN_MINUTES_LADDER",
          "decisionClass": "FIT",
          "polarity": "NEUTRAL",
          "category": "development",
          "facts": {
            "ladder": [
              {
                "rank": 1,
                "median": 1472,
                "low": 1218,
                "high": 1610,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 1168,
                "low": 599,
                "high": 1346,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 3,
                "median": 742,
                "low": 79,
                "high": 1218,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 4,
                "median": 474,
                "low": 35,
                "high": 1034,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 5,
                "median": 180,
                "low": 32,
                "high": 270,
                "band": "fringe",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 6,
                "median": 40,
                "low": 0,
                "high": 71,
                "band": "fringe",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              }
            ],
            "seasonsObserved": 4,
            "medianIntake": 8,
            "medianPlayed": 7,
            "seasonsWithAnImpactFreshman": 4
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": null,
            "season": "2022, 2023, 2024, 2025",
            "source": "roster_players:freshman-minutes",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2023",
                "2024",
                "2025"
              ],
              "seasonsUnread": [],
              "n": 32,
              "cohort": null
            },
            "comparison": null
          }
        },
        {
          "kind": "PROGRAMME_POOL_BENCHMARK",
          "decisionClass": "CONTEXT",
          "polarity": "NEUTRAL",
          "category": "development",
          "facts": {
            "rank": 1,
            "programmeMedian": 1472,
            "programmeSpread": {
              "low": 1218,
              "high": 1610,
              "agreement": "tight"
            },
            "pool": {
              "n": 770,
              "p25": 901,
              "median": 1118,
              "p75": 1289
            },
            "band": "above-p75"
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": null,
            "season": "2022, 2023, 2024, 2025",
            "source": "roster_players:pool-benchmarks",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2023",
                "2024",
                "2025"
              ],
              "seasonsUnread": [],
              "n": 32,
              "cohort": null
            },
            "comparison": {
              "basis": "mens-soccer programmes with a readable freshman ladder, 2022-2023-2024-2025",
              "statistic": "ladder-rank-1-median-minutes",
              "poolSize": 920,
              "percentile": null,
              "band": "above-p75"
            }
          }
        }
      ],
      "ACADEMIC_PROGRAMME_FIT": [],
      "PROGRAMME_CONTEXT": [
        {
          "kind": "COACH_CONTEXT",
          "decisionClass": "CONTEXT",
          "polarity": "NEUTRAL",
          "category": "coach",
          "facts": {
            "coach": "Bob Carlson",
            "seasonsObserved": 5,
            "since": 2022,
            "windowBounded": true,
            "knownThrough": 2026,
            "stillInPost": true,
            "context": "ESTABLISHED"
          },
          "qualification": {
            "tier": "SIGNAL",
            "temporality": "STATIC",
            "confidence": "MEDIUM",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "UNKNOWN",
              "ageDays": null,
              "reason": "no scrape date on these roster rows"
            },
            "season": "2022-2026",
            "source": "coach_seasons",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2023",
                "2024",
                "2025",
                "2026"
              ],
              "seasonsUnread": [],
              "n": 5,
              "cohort": {
                "coach": "Bob Carlson"
              }
            },
            "comparison": null
          }
        }
      ]
    }
  }
};
