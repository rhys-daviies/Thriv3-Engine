/**
 * Real PROGRAMME_CONTEXT payloads, captured from the operator endpoint.
 *
 * The cases that matter here are about what may and may not be said about a
 * coach's start year: one programme where the appointment year was observed,
 * one where it is only the earliest season we looked at, one with unreadable
 * staff pages inside the window, one classified NEW, and one with no coach
 * data at all. Jacksonville is here to check that its coach-attributed
 * PATHWAY evidence stays in the pathway section.
 */
export const CONTEXT_FIXTURES = {
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
  "Clemson": {
    "programme": {
      "resolved": true
    },
    "summary": {
      "reasonCount": 1,
      "hasPositiveReasons": true,
      "openingIdentified": false,
      "hasEvidence": true,
      "evidenceCount": 5,
      "sectionCounts": {
        "ROSTER_OPPORTUNITY": 1,
        "RECRUITMENT_PATHWAY": 2,
        "DEVELOPMENT": 0,
        "ACADEMIC_PROGRAMME_FIT": 1,
        "PROGRAMME_CONTEXT": 1
      }
    },
    "topReasons": [
      {
        "primary": {
          "kind": "POSTSEASON_RESULT",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "round": "appearance"
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
            "season": "2025",
            "source": "colleges:postseason_2025_round",
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
          "kind": "POSITION_GROUP_SIZE",
          "decisionClass": "CONTEXT",
          "polarity": "NEUTRAL",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "count": 10,
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
        }
      ],
      "RECRUITMENT_PATHWAY": [
        {
          "kind": "POSITION_INTAKE_HISTORY",
          "decisionClass": "CONTEXT",
          "polarity": "NEUTRAL",
          "category": "internal",
          "facts": {
            "position": "DEFENSE",
            "count": 14,
            "seasons": [
              "2023",
              "2024",
              "2025",
              "2026"
            ],
            "observedIntakes": 4,
            "intakesWithArrival": 4,
            "meanPerIntake": 3.5,
            "byIntake": {
              "2022->2023": 6,
              "2023->2024": 3,
              "2024->2025": 3,
              "2025->2026": 2
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
              "n": 14,
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
            "atPosition": 1,
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
        }
      ],
      "DEVELOPMENT": [],
      "ACADEMIC_PROGRAMME_FIT": [
        {
          "kind": "POSTSEASON_RESULT",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "round": "appearance"
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
            "season": "2025",
            "source": "colleges:postseason_2025_round",
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
            "coach": "Mike Noonan",
            "seasonsObserved": 3,
            "since": 2024,
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
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
            },
            "season": "2024-2026",
            "source": "coach_seasons",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2024",
                "2025",
                "2026"
              ],
              "seasonsUnread": [
                "2022",
                "2023"
              ],
              "n": 3,
              "cohort": {
                "coach": "Mike Noonan"
              }
            },
            "comparison": null
          }
        }
      ]
    }
  },
  "Oregon State": {
    "programme": {
      "resolved": true
    },
    "summary": {
      "reasonCount": 3,
      "hasPositiveReasons": true,
      "openingIdentified": true,
      "hasEvidence": true,
      "evidenceCount": 13,
      "sectionCounts": {
        "ROSTER_OPPORTUNITY": 2,
        "RECRUITMENT_PATHWAY": 4,
        "DEVELOPMENT": 4,
        "ACADEMIC_PROGRAMME_FIT": 2,
        "PROGRAMME_CONTEXT": 1
      }
    },
    "topReasons": [
      {
        "primary": {
          "kind": "ELIGIBILITY_CLIFF",
          "decisionClass": "OPENING",
          "polarity": "POSITIVE",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "players": 3,
            "projectedMinutes": 1307,
            "beforeClassYear": 2027,
            "byYear": [
              {
                "year": 2027,
                "minutes": 1307,
                "players": 3
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
        "supporting": [],
        "decisionClass": "OPENING",
        "category": "roster",
        "dedupeGroup": "position-opportunity",
        "section": "ROSTER_OPPORTUNITY"
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
          "kind": "POSTSEASON_RESULT",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "round": "appearance"
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
            "season": "2025",
            "source": "colleges:postseason_2025_round",
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
          "kind": "ELIGIBILITY_CLIFF",
          "decisionClass": "OPENING",
          "polarity": "POSITIVE",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "players": 3,
            "projectedMinutes": 1307,
            "beforeClassYear": 2027,
            "byYear": [
              {
                "year": 2027,
                "minutes": 1307,
                "players": 3
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
            "count": 8,
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
        }
      ],
      "RECRUITMENT_PATHWAY": [
        {
          "kind": "POSITION_INTAKE_HISTORY",
          "decisionClass": "CONTEXT",
          "polarity": "NEUTRAL",
          "category": "internal",
          "facts": {
            "position": "DEFENSE",
            "count": 18,
            "seasons": [
              "2023",
              "2024",
              "2025",
              "2026"
            ],
            "observedIntakes": 4,
            "intakesWithArrival": 4,
            "meanPerIntake": 4.5,
            "byIntake": {
              "2022->2023": 7,
              "2023->2024": 5,
              "2024->2025": 2,
              "2025->2026": 4
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
              "n": 18,
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
            "arrivals": 6,
            "atPosition": 1,
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
            "count": 7,
            "countries": [
              "Canada",
              "Germany",
              "Italy",
              "Spain"
            ],
            "uniqueCountries": 4
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
            "count": 7,
            "squadSize": 29,
            "share": 0.24
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
                "median": 545,
                "low": 28,
                "high": 732,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 2,
                "median": 301,
                "low": 0,
                "high": 602,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 2
              },
              {
                "rank": 3,
                "median": 78,
                "low": 78,
                "high": 78,
                "band": "fringe",
                "agreement": "tight",
                "seasonsWithThisMany": 1
              }
            ],
            "cohort": {
              "position": "DEFENSE",
              "origin": "international",
              "applied": true
            },
            "asked": {
              "position": "DEFENSE",
              "origin": "international"
            },
            "refused": null,
            "relaxed": null,
            "players": 6,
            "seasonsObserved": 3
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": null,
            "season": "2022, 2023, 2024",
            "source": "roster_players:freshman-minutes",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2023",
                "2024"
              ],
              "seasonsUnread": [],
              "n": 6,
              "cohort": {
                "position": "DEFENSE",
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
            "verdictKey": "regime-change",
            "verdictNote": "the coach changed and the pattern changed with them — the earlier seasons describe a different programme",
            "seasonsObserved": 4,
            "players": 35,
            "shareBySeason": [
              {
                "season": "2022",
                "shareOfSquadMinutes": 0.35976119402985074,
                "intake": 14,
                "measured": 14
              },
              {
                "season": "2023",
                "shareOfSquadMinutes": 0.0820000932879332,
                "intake": 9,
                "measured": 9
              },
              {
                "season": "2024",
                "shareOfSquadMinutes": 0.06389668725435149,
                "intake": 8,
                "measured": 8
              },
              {
                "season": "2025",
                "shareOfSquadMinutes": 0.05423389471204805,
                "intake": 4,
                "measured": 4
              }
            ],
            "minuteShares": {
              "n": 12,
              "freshman": 7.9,
              "newcomer": 31.1,
              "returning": 61
            },
            "spread": 12.728561160250722,
            "step": -16.664674894684396,
            "coach": "Jarred Brookins",
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
                "median": 901,
                "low": 545,
                "high": 1111,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 608,
                "low": 71,
                "high": 992,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 3,
                "median": 76,
                "low": 1,
                "high": 991,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 4,
                "median": 16,
                "low": 0,
                "high": 732,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 5,
                "median": 0,
                "low": 0,
                "high": 635,
                "band": "none",
                "agreement": "wide",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 6,
                "median": 0,
                "low": 0,
                "high": 602,
                "band": "none",
                "agreement": "wide",
                "seasonsWithThisMany": 3
              }
            ],
            "seasonsObserved": 4,
            "medianIntake": 9,
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
              "n": 35,
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
            "programmeMedian": 901,
            "programmeSpread": {
              "low": 545,
              "high": 1111,
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
              "n": 35,
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
          "kind": "POSTSEASON_RESULT",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "round": "appearance"
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
            "season": "2025",
            "source": "colleges:postseason_2025_round",
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
            "coach": "Jarred Brookins",
            "seasonsObserved": 3,
            "since": 2024,
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
            "season": "2024-2026",
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
              "n": 3,
              "cohort": {
                "coach": "Jarred Brookins"
              }
            },
            "comparison": null
          }
        }
      ]
    }
  },
  "Vermont": {
    "programme": {
      "resolved": true
    },
    "summary": {
      "reasonCount": 2,
      "hasPositiveReasons": true,
      "openingIdentified": true,
      "hasEvidence": true,
      "evidenceCount": 17,
      "sectionCounts": {
        "ROSTER_OPPORTUNITY": 5,
        "RECRUITMENT_PATHWAY": 4,
        "DEVELOPMENT": 4,
        "ACADEMIC_PROGRAMME_FIT": 3,
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
            "count": 4,
            "names": [
              "Jean-David Mougenot Koffi",
              "Karl Daly",
              "Pieter Bultman",
              "Patrick Aguilar"
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
              "starterCount": 1,
              "names": [
                "Pieter Bultman"
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
              "projectedMinutes": 506,
              "beforeClassYear": 2027,
              "byYear": [
                {
                  "year": 2026,
                  "minutes": 506,
                  "players": 4
                },
                {
                  "year": 2027,
                  "minutes": 0,
                  "players": 1
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
          "kind": "CONFERENCE_TITLE",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "conference": "America East"
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
            "season": "2025",
            "source": "colleges:conference_champion_2025",
            "sourceUrl": null,
            "window": null,
            "comparison": null
          }
        },
        "supporting": [
          {
            "kind": "POSTSEASON_RESULT",
            "decisionClass": "FIT",
            "polarity": "POSITIVE",
            "category": "performance",
            "facts": {
              "round": "appearance"
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
              "season": "2025",
              "source": "colleges:postseason_2025_round",
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
              "recentWinPct": 0.77,
              "priorWinPct": 0.71
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
            "count": 4,
            "names": [
              "Jean-David Mougenot Koffi",
              "Karl Daly",
              "Pieter Bultman",
              "Patrick Aguilar"
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
            "starterCount": 1,
            "names": [
              "Pieter Bultman"
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
            "projectedMinutes": 506,
            "beforeClassYear": 2027,
            "byYear": [
              {
                "year": 2026,
                "minutes": 506,
                "players": 4
              },
              {
                "year": 2027,
                "minutes": 0,
                "players": 1
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
            "count": 10,
            "squadSize": 31
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
            "total": 7,
            "starters": 2,
            "names": [
              "Jean-David Mougenot Koffi",
              "Karl Daly",
              "Pieter Bultman",
              "Patrick Aguilar",
              "David Ismail",
              "Halim Bangura",
              "Noel Bjork"
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
          "kind": "POSITION_INTAKE_HISTORY",
          "decisionClass": "CONTEXT",
          "polarity": "NEUTRAL",
          "category": "internal",
          "facts": {
            "position": "DEFENSE",
            "count": 20,
            "seasons": [
              "2023",
              "2024",
              "2025",
              "2026"
            ],
            "observedIntakes": 4,
            "intakesWithArrival": 4,
            "meanPerIntake": 5,
            "byIntake": {
              "2022->2023": 5,
              "2023->2024": 4,
              "2024->2025": 4,
              "2025->2026": 7
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
              "n": 20,
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
            "arrivals": 7,
            "atPosition": 3,
            "squadSize": 31
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
            "count": 16,
            "countries": [
              "Brazil",
              "Czechia",
              "France",
              "Germany",
              "Hong Kong",
              "Ireland",
              "Morocco",
              "Sweden",
              "United Kingdom"
            ],
            "uniqueCountries": 9
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
            "count": 16,
            "squadSize": 31,
            "share": 0.52
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
                "median": 1284,
                "low": 147,
                "high": 1870,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 1035,
                "low": 1024,
                "high": 1045,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 2
              },
              {
                "rank": 3,
                "median": 312,
                "low": 179,
                "high": 444,
                "band": "rotation",
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
            "refused": "DEFENSE / international: only 3 in 2 seasons — too few to read separately",
            "relaxed": "international",
            "players": 8,
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
              "n": 8,
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
            "verdictKey": "change-too-recent",
            "verdictNote": "the coach changed too recently to compare the two spells — the newest season is the only guide",
            "seasonsObserved": 4,
            "players": 21,
            "shareBySeason": [
              {
                "season": "2022",
                "shareOfSquadMinutes": 0.0067421914415447416,
                "intake": 3,
                "measured": 3
              },
              {
                "season": "2023",
                "shareOfSquadMinutes": 0.170269498143034,
                "intake": 8,
                "measured": 8
              },
              {
                "season": "2024",
                "shareOfSquadMinutes": 0.1323357695800718,
                "intake": 4,
                "measured": 4
              },
              {
                "season": "2025",
                "shareOfSquadMinutes": 0.1610370537731586,
                "intake": 6,
                "measured": 6
              }
            ],
            "minuteShares": {
              "n": 12,
              "freshman": 15.5,
              "newcomer": 27.6,
              "returning": 56.9
            },
            "spread": 6.551230845930623,
            "step": 5.818056688432582,
            "coach": "Adrian Dubois",
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
                "median": 1332,
                "low": 147,
                "high": 1870,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 1035,
                "low": 0,
                "high": 1482,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 3,
                "median": 222,
                "low": 0,
                "high": 482,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 4,
                "median": 125,
                "low": 0,
                "high": 179,
                "band": "fringe",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 5,
                "median": 78,
                "low": 43,
                "high": 113,
                "band": "fringe",
                "agreement": "tight",
                "seasonsWithThisMany": 2
              },
              {
                "rank": 6,
                "median": 9,
                "low": 0,
                "high": 17,
                "band": "fringe",
                "agreement": "tight",
                "seasonsWithThisMany": 2
              }
            ],
            "seasonsObserved": 4,
            "medianIntake": 5,
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
              "n": 21,
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
            "programmeMedian": 1332,
            "programmeSpread": {
              "low": 147,
              "high": 1870,
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
              "n": 21,
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
      "ACADEMIC_PROGRAMME_FIT": [
        {
          "kind": "CONFERENCE_TITLE",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "conference": "America East"
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
            "season": "2025",
            "source": "colleges:conference_champion_2025",
            "sourceUrl": null,
            "window": null,
            "comparison": null
          }
        },
        {
          "kind": "POSTSEASON_RESULT",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "round": "appearance"
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
            "season": "2025",
            "source": "colleges:postseason_2025_round",
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
            "recentWinPct": 0.77,
            "priorWinPct": 0.71
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
            "coach": "Adrian Dubois",
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
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
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
                "coach": "Adrian Dubois"
              }
            },
            "comparison": null
          }
        }
      ]
    }
  },
  "Gardner-Webb": {
    "programme": {
      "resolved": true
    },
    "summary": {
      "reasonCount": 4,
      "hasPositiveReasons": true,
      "openingIdentified": true,
      "hasEvidence": true,
      "evidenceCount": 15,
      "sectionCounts": {
        "ROSTER_OPPORTUNITY": 3,
        "RECRUITMENT_PATHWAY": 6,
        "DEVELOPMENT": 4,
        "ACADEMIC_PROGRAMME_FIT": 2,
        "PROGRAMME_CONTEXT": 0
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
            "count": 2,
            "names": [
              "Noah Simon",
              "Tom Chartier"
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
        "supporting": [],
        "decisionClass": "OPENING",
        "category": "roster",
        "dedupeGroup": "position-opportunity",
        "section": "ROSTER_OPPORTUNITY"
      },
      {
        "primary": {
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
              "2023"
            ],
            "namedArrival": "Malcolm Ward",
            "namedArrivalSeason": "2023",
            "observedIntakes": 4,
            "arrivals": [
              {
                "player": "Malcolm Ward",
                "season": "2023",
                "country": "Australia",
                "region": "OCEANIA",
                "position": "DEFENSE",
                "coach": null,
                "coachAttribution": "UNKNOWN"
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
            "season": "2023",
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
        "supporting": [
          {
            "kind": "HISTORICAL_SAME_REGION",
            "decisionClass": "PATHWAY",
            "polarity": "POSITIVE",
            "category": "international",
            "facts": {
              "region": "OCEANIA",
              "countries": [
                "Australia"
              ],
              "excludingCountry": "New Zealand",
              "count": 4,
              "names": [
                "Pat Millard",
                "Kaelan Debbage",
                "Malcolm Ward",
                "Ryan Tappouras"
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
              "season": "2023-2025",
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
                "n": 4,
                "cohort": {
                  "region": "OCEANIA",
                  "excludingCountry": "New Zealand"
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
            "recentWinPct": 0.73,
            "priorWinPct": 0.41
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
            "count": 2,
            "names": [
              "Noah Simon",
              "Tom Chartier"
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
          "kind": "POSITION_GROUP_SIZE",
          "decisionClass": "CONTEXT",
          "polarity": "NEUTRAL",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "count": 11,
            "squadSize": 33
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
            "total": 4,
            "starters": 0,
            "names": [
              "Lars Olav Jøsendal",
              "Axel-Ambroise Gravel",
              "Noah Simon",
              "Tom Chartier"
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
              "2023"
            ],
            "namedArrival": "Malcolm Ward",
            "namedArrivalSeason": "2023",
            "observedIntakes": 4,
            "arrivals": [
              {
                "player": "Malcolm Ward",
                "season": "2023",
                "country": "Australia",
                "region": "OCEANIA",
                "position": "DEFENSE",
                "coach": null,
                "coachAttribution": "UNKNOWN"
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
            "season": "2023",
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
          "kind": "HISTORICAL_SAME_REGION",
          "decisionClass": "PATHWAY",
          "polarity": "POSITIVE",
          "category": "international",
          "facts": {
            "region": "OCEANIA",
            "countries": [
              "Australia"
            ],
            "excludingCountry": "New Zealand",
            "count": 4,
            "names": [
              "Pat Millard",
              "Kaelan Debbage",
              "Malcolm Ward",
              "Ryan Tappouras"
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
            "season": "2023-2025",
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
              "n": 4,
              "cohort": {
                "region": "OCEANIA",
                "excludingCountry": "New Zealand"
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
            "count": 29,
            "seasons": [
              "2023",
              "2024",
              "2025",
              "2026"
            ],
            "observedIntakes": 4,
            "intakesWithArrival": 4,
            "meanPerIntake": 7.25,
            "byIntake": {
              "2022->2023": 8,
              "2023->2024": 5,
              "2024->2025": 5,
              "2025->2026": 11
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
              "n": 29,
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
            "arrivals": 10,
            "atPosition": 5,
            "squadSize": 33
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
              "Canada",
              "France",
              "Germany",
              "Israel",
              "Norway",
              "Spain",
              "Uganda",
              "Zambia"
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
            "squadSize": 33,
            "share": 0.58
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
                "median": 1088,
                "low": 430,
                "high": 1457,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 2,
                "median": 65,
                "low": 0,
                "high": 960,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 3,
                "median": 23,
                "low": 0,
                "high": 45,
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
              "origin": "international",
              "applied": true
            },
            "asked": {
              "position": "DEFENSE",
              "origin": "international"
            },
            "refused": null,
            "relaxed": null,
            "players": 9,
            "seasonsObserved": 3
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": null,
            "season": "2022, 2023, 2024",
            "source": "roster_players:freshman-minutes",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2023",
                "2024"
              ],
              "seasonsUnread": [],
              "n": 9,
              "cohort": {
                "position": "DEFENSE",
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
            "verdictKey": "coach-unknown",
            "verdictNote": "no coach on file, so these seasons cannot be attributed to anyone",
            "seasonsObserved": 4,
            "players": 53,
            "shareBySeason": [
              {
                "season": "2022",
                "shareOfSquadMinutes": 0.472436921111466,
                "intake": 30,
                "measured": 30
              },
              {
                "season": "2023",
                "shareOfSquadMinutes": 0.21918666583119242,
                "intake": 6,
                "measured": 6
              },
              {
                "season": "2024",
                "shareOfSquadMinutes": 0.12684066213059816,
                "intake": 8,
                "measured": 8
              },
              {
                "season": "2025",
                "shareOfSquadMinutes": 0.17509771710190902,
                "intake": 9,
                "measured": 9
              }
            ],
            "minuteShares": {
              "n": 11,
              "freshman": 13.9,
              "newcomer": 41.4,
              "returning": 44.7
            },
            "spread": 13.341275974774662,
            "step": -19.484260385507564,
            "coach": null,
            "coachStillInPost": null
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
                "median": 1305,
                "low": 1088,
                "high": 1457,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 935,
                "low": 585,
                "high": 1045,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 3,
                "median": 852,
                "low": 219,
                "high": 960,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 4,
                "median": 182,
                "low": 49,
                "high": 887,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 5,
                "median": 106,
                "low": 10,
                "high": 841,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 6,
                "median": 31,
                "low": 0,
                "high": 799,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              }
            ],
            "seasonsObserved": 4,
            "medianIntake": 9,
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
              "n": 53,
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
            "programmeMedian": 1305,
            "programmeSpread": {
              "low": 1088,
              "high": 1457,
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
              "n": 53,
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
            "recentWinPct": 0.73,
            "priorWinPct": 0.41
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
      "PROGRAMME_CONTEXT": []
    }
  }
};
