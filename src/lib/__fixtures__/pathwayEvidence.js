/**
 * Real RECRUITMENT_PATHWAY payloads, captured from the operator endpoint.
 *
 * Between them these cover every shape the section must handle: a coach claim
 * with a null position and one with a position set, current-country presence
 * beside historical, a regional count that excludes the athlete's own country,
 * an arrival with no name exposed, both international measurements together,
 * intake history with transfer behaviour, and a programme with no pathway
 * evidence at all.
 */
export const PATHWAY_FIXTURES = {
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
  "Wake Forest": {
    "programme": {
      "resolved": true
    },
    "summary": {
      "reasonCount": 3,
      "hasPositiveReasons": true,
      "openingIdentified": true,
      "hasEvidence": true,
      "evidenceCount": 16,
      "sectionCounts": {
        "ROSTER_OPPORTUNITY": 4,
        "RECRUITMENT_PATHWAY": 6,
        "DEVELOPMENT": 4,
        "ACADEMIC_PROGRAMME_FIT": 1,
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
            "count": 1,
            "names": [
              "Luke Kirilenko"
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
            "kind": "ELIGIBILITY_CLIFF",
            "decisionClass": "OPENING",
            "polarity": "POSITIVE",
            "category": "roster",
            "facts": {
              "position": "DEFENSE",
              "players": 2,
              "projectedMinutes": 1402,
              "beforeClassYear": 2027,
              "byYear": [
                {
                  "year": 2026,
                  "minutes": 0,
                  "players": 1
                },
                {
                  "year": 2027,
                  "minutes": 1402,
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
          "kind": "COACH_ARRIVAL_SAME_COUNTRY",
          "decisionClass": "PATHWAY",
          "polarity": "POSITIVE",
          "category": "international",
          "facts": {
            "country": "New Zealand",
            "coach": "Bobby Muuss",
            "position": null,
            "count": 1,
            "seasons": [
              "2026"
            ],
            "namedArrival": "Joby Reid",
            "namedArrivalSeason": "2026",
            "attributableIntakes": 4,
            "intakesWithArrival": 1,
            "arrivals": [
              {
                "player": "Joby Reid",
                "season": "2026",
                "country": "New Zealand",
                "region": "OCEANIA",
                "position": "FORWARD",
                "coach": "Bobby Muuss",
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
                "country": "New Zealand",
                "coach": "Bobby Muuss",
                "position": null
              }
            },
            "comparison": null
          }
        },
        "supporting": [
          {
            "kind": "CURRENT_SAME_COUNTRY",
            "decisionClass": "PATHWAY",
            "polarity": "POSITIVE",
            "category": "international",
            "facts": {
              "country": "New Zealand",
              "count": 1,
              "names": [
                "Joby Reid"
              ]
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
            "count": 1,
            "names": [
              "Luke Kirilenko"
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
          "kind": "ELIGIBILITY_CLIFF",
          "decisionClass": "OPENING",
          "polarity": "POSITIVE",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "players": 2,
            "projectedMinutes": 1402,
            "beforeClassYear": 2027,
            "byYear": [
              {
                "year": 2026,
                "minutes": 0,
                "players": 1
              },
              {
                "year": 2027,
                "minutes": 1402,
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
            "squadSize": 30
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
            "total": 2,
            "starters": 0,
            "names": [
              "Pierce Bateson",
              "Luke Kirilenko"
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
            "coach": "Bobby Muuss",
            "position": null,
            "count": 1,
            "seasons": [
              "2026"
            ],
            "namedArrival": "Joby Reid",
            "namedArrivalSeason": "2026",
            "attributableIntakes": 4,
            "intakesWithArrival": 1,
            "arrivals": [
              {
                "player": "Joby Reid",
                "season": "2026",
                "country": "New Zealand",
                "region": "OCEANIA",
                "position": "FORWARD",
                "coach": "Bobby Muuss",
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
                "country": "New Zealand",
                "coach": "Bobby Muuss",
                "position": null
              }
            },
            "comparison": null
          }
        },
        {
          "kind": "CURRENT_SAME_COUNTRY",
          "decisionClass": "PATHWAY",
          "polarity": "POSITIVE",
          "category": "international",
          "facts": {
            "country": "New Zealand",
            "count": 1,
            "names": [
              "Joby Reid"
            ]
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
              "2022->2023": 2,
              "2023->2024": 5,
              "2024->2025": 3,
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
            "atPosition": 3,
            "squadSize": 30
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
            "count": 9,
            "countries": [
              "Canada",
              "Ghana",
              "Liberia",
              "New Zealand",
              "Spain",
              "United Kingdom"
            ],
            "uniqueCountries": 6
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
            "count": 9,
            "squadSize": 30,
            "share": 0.3
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
                "median": 706,
                "low": 384,
                "high": 1522,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 106,
                "low": 43,
                "high": 1310,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 3,
                "median": 71,
                "low": 30,
                "high": 110,
                "band": "fringe",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 4,
                "median": 52,
                "low": 52,
                "high": 52,
                "band": "fringe",
                "agreement": "tight",
                "seasonsWithThisMany": 1
              },
              {
                "rank": 5,
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
            "refused": "DEFENSE / international: only 2 in 2 seasons — too few to read separately",
            "relaxed": "DEFENSE",
            "players": 13,
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
              "n": 13,
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
            "players": 30,
            "shareBySeason": [
              {
                "season": "2022",
                "shareOfSquadMinutes": 0.10247474747474747,
                "intake": 7,
                "measured": 7
              },
              {
                "season": "2023",
                "shareOfSquadMinutes": 0.13913772329613913,
                "intake": 6,
                "measured": 6
              },
              {
                "season": "2024",
                "shareOfSquadMinutes": 0.23930635838150288,
                "intake": 10,
                "measured": 10
              },
              {
                "season": "2025",
                "shareOfSquadMinutes": 0.09818030447193149,
                "intake": 7,
                "measured": 7
              }
            ],
            "minuteShares": {
              "n": 11,
              "freshman": 14.6,
              "newcomer": 3.1,
              "returning": 82.3
            },
            "spread": 5.6851415155987794,
            "step": 4.793709604127386,
            "coach": "Bobby Muuss",
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
                "median": 1167,
                "low": 526,
                "high": 1522,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 606,
                "low": 384,
                "high": 1310,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 3,
                "median": 386,
                "low": 168,
                "high": 1298,
                "band": "rotation",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 4,
                "median": 259,
                "low": 122,
                "high": 858,
                "band": "rotation",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 5,
                "median": 79,
                "low": 43,
                "high": 403,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 6,
                "median": 51,
                "low": 0,
                "high": 243,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              }
            ],
            "seasonsObserved": 4,
            "medianIntake": 7,
            "medianPlayed": 6,
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
              "n": 30,
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
            "programmeMedian": 1167,
            "programmeSpread": {
              "low": 526,
              "high": 1522,
              "agreement": "tight"
            },
            "pool": {
              "n": 770,
              "p25": 901,
              "median": 1118,
              "p75": 1289
            },
            "band": "median-to-p75"
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
              "n": 30,
              "cohort": null
            },
            "comparison": {
              "basis": "mens-soccer programmes with a readable freshman ladder, 2022-2023-2024-2025",
              "statistic": "ladder-rank-1-median-minutes",
              "poolSize": 920,
              "percentile": null,
              "band": "median-to-p75"
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
        }
      ],
      "PROGRAMME_CONTEXT": [
        {
          "kind": "COACH_CONTEXT",
          "decisionClass": "CONTEXT",
          "polarity": "NEUTRAL",
          "category": "coach",
          "facts": {
            "coach": "Bobby Muuss",
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
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
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
                "coach": "Bobby Muuss"
              }
            },
            "comparison": null
          }
        }
      ]
    }
  },
  "Charlotte": {
    "programme": {
      "resolved": true
    },
    "summary": {
      "reasonCount": 2,
      "hasPositiveReasons": true,
      "openingIdentified": true,
      "hasEvidence": true,
      "evidenceCount": 13,
      "sectionCounts": {
        "ROSTER_OPPORTUNITY": 3,
        "RECRUITMENT_PATHWAY": 5,
        "DEVELOPMENT": 4,
        "ACADEMIC_PROGRAMME_FIT": 0,
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
            "players": 1,
            "projectedMinutes": 1314,
            "beforeClassYear": 2027,
            "byYear": [
              {
                "year": 2026,
                "minutes": 0,
                "players": 0
              },
              {
                "year": 2027,
                "minutes": 1314,
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
        "supporting": [],
        "decisionClass": "OPENING",
        "category": "roster",
        "dedupeGroup": "position-opportunity",
        "section": "ROSTER_OPPORTUNITY"
      },
      {
        "primary": {
          "kind": "HISTORICAL_SAME_COUNTRY",
          "decisionClass": "PATHWAY",
          "polarity": "POSITIVE",
          "category": "international",
          "facts": {
            "country": "New Zealand",
            "count": 1,
            "names": [
              "Luke Johnson"
            ],
            "seasonsPresent": [
              "2022"
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
            "season": "2022",
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
        "supporting": [],
        "decisionClass": "PATHWAY",
        "category": "international",
        "dedupeGroup": "international-connection",
        "section": "RECRUITMENT_PATHWAY"
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
            "players": 1,
            "projectedMinutes": 1314,
            "beforeClassYear": 2027,
            "byYear": [
              {
                "year": 2026,
                "minutes": 0,
                "players": 0
              },
              {
                "year": 2027,
                "minutes": 1314,
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
            "count": 8,
            "squadSize": 26
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
            "total": 2,
            "starters": 1,
            "names": [
              "Alex Svetanoff",
              "Ben Fisher"
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
          "kind": "HISTORICAL_SAME_COUNTRY",
          "decisionClass": "PATHWAY",
          "polarity": "POSITIVE",
          "category": "international",
          "facts": {
            "country": "New Zealand",
            "count": 1,
            "names": [
              "Luke Johnson"
            ],
            "seasonsPresent": [
              "2022"
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
            "season": "2022",
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
              "2022->2023": 4,
              "2023->2024": 5,
              "2024->2025": 7,
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
            "arrivals": 3,
            "atPosition": 1,
            "squadSize": 26
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
              "Australia",
              "Brazil",
              "Canada",
              "Cyprus",
              "Iceland",
              "Ireland",
              "Israel",
              "Japan",
              "Norway",
              "Poland",
              "Portugal",
              "Trinidad and Tobago",
              "United Kingdom"
            ],
            "uniqueCountries": 13
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
            "squadSize": 26,
            "share": 0.62
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
                "median": 803,
                "low": 240,
                "high": 1262,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 711,
                "low": 22,
                "high": 817,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 3,
                "median": 638,
                "low": 589,
                "high": 686,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 2
              },
              {
                "rank": 4,
                "median": 5,
                "low": 0,
                "high": 10,
                "band": "fringe",
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
            "verdictKey": "policy-shift-same-coach",
            "verdictNote": "the same coach, but the recent seasons look different from the early ones — weight the recent ones",
            "seasonsObserved": 4,
            "players": 29,
            "shareBySeason": [
              {
                "season": "2022",
                "shareOfSquadMinutes": 0.1210762331838565,
                "intake": 4,
                "measured": 4
              },
              {
                "season": "2023",
                "shareOfSquadMinutes": 0.051211267605633805,
                "intake": 9,
                "measured": 9
              },
              {
                "season": "2024",
                "shareOfSquadMinutes": 0.1531332280147446,
                "intake": 9,
                "measured": 9
              },
              {
                "season": "2025",
                "shareOfSquadMinutes": 0.27757364389362893,
                "intake": 7,
                "measured": 7
              }
            ],
            "minuteShares": {
              "n": 10,
              "freshman": 16.4,
              "newcomer": 21.4,
              "returning": 62.2
            },
            "spread": 8.197317869591206,
            "step": 12.920968555944158,
            "coach": "Kevin Langan",
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
                "median": 837,
                "low": 668,
                "high": 1262,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 691,
                "low": 136,
                "high": 1055,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 3,
                "median": 478,
                "low": 83,
                "high": 817,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 4,
                "median": 401,
                "low": 22,
                "high": 624,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 5,
                "median": 13,
                "low": 0,
                "high": 589,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 6,
                "median": 0,
                "low": 0,
                "high": 100,
                "band": "none",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              }
            ],
            "seasonsObserved": 4,
            "medianIntake": 8,
            "medianPlayed": 5,
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
              "n": 29,
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
            "programmeMedian": 837,
            "programmeSpread": {
              "low": 668,
              "high": 1262,
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
              "n": 29,
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
      "ACADEMIC_PROGRAMME_FIT": [],
      "PROGRAMME_CONTEXT": [
        {
          "kind": "COACH_CONTEXT",
          "decisionClass": "CONTEXT",
          "polarity": "NEUTRAL",
          "category": "coach",
          "facts": {
            "coach": "Kevin Langan",
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
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
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
                "coach": "Kevin Langan"
              }
            },
            "comparison": null
          }
        }
      ]
    }
  },
  "Maryland": {
    "programme": {
      "resolved": true
    },
    "summary": {
      "reasonCount": 2,
      "hasPositiveReasons": true,
      "openingIdentified": false,
      "hasEvidence": true,
      "evidenceCount": 14,
      "sectionCounts": {
        "ROSTER_OPPORTUNITY": 2,
        "RECRUITMENT_PATHWAY": 5,
        "DEVELOPMENT": 4,
        "ACADEMIC_PROGRAMME_FIT": 2,
        "PROGRAMME_CONTEXT": 1
      }
    },
    "topReasons": [
      {
        "primary": {
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
            "count": 1,
            "names": [
              "Max Rogers"
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
            "season": "2024",
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
                "region": "OCEANIA",
                "excludingCountry": "New Zealand"
              }
            },
            "comparison": null
          }
        },
        "supporting": [],
        "decisionClass": "PATHWAY",
        "category": "international",
        "dedupeGroup": "international-connection",
        "section": "RECRUITMENT_PATHWAY"
      },
      {
        "primary": {
          "kind": "POSTSEASON_RESULT",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "round": "r16"
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
        "supporting": [
          {
            "kind": "PROGRAM_MOMENTUM",
            "decisionClass": "FIT",
            "polarity": "POSITIVE",
            "category": "performance",
            "facts": {
              "classification": "RISING",
              "recentWinPct": 0.64,
              "priorWinPct": 0.5
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
          "kind": "POSITION_GROUP_SIZE",
          "decisionClass": "CONTEXT",
          "polarity": "NEUTRAL",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "count": 8,
            "squadSize": 26
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
            "total": 1,
            "starters": 1,
            "names": [
              "Albi Ndrenika"
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
            "count": 1,
            "names": [
              "Max Rogers"
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
            "season": "2024",
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
            "count": 15,
            "seasons": [
              "2023",
              "2024",
              "2025",
              "2026"
            ],
            "observedIntakes": 4,
            "intakesWithArrival": 4,
            "meanPerIntake": 3.75,
            "byIntake": {
              "2022->2023": 3,
              "2023->2024": 3,
              "2024->2025": 5,
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
              "n": 15,
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
            "arrivals": 4,
            "atPosition": 1,
            "squadSize": 26
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
            "count": 15,
            "countries": [
              "Austria",
              "Canada",
              "Denmark",
              "France",
              "Germany",
              "Ghana",
              "Panama",
              "Spain",
              "Uganda"
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
            "count": 15,
            "squadSize": 26,
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
                "median": 1328,
                "low": 883,
                "high": 1644,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 246,
                "low": 154,
                "high": 850,
                "band": "rotation",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 3,
                "median": 69,
                "low": 18,
                "high": 119,
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
            "verdictKey": "steady",
            "verdictNote": "one coach, a consistent pattern — every season counts and the record is as firm as this gets",
            "seasonsObserved": 4,
            "players": 35,
            "shareBySeason": [
              {
                "season": "2022",
                "shareOfSquadMinutes": 0.15555105758526466,
                "intake": 9,
                "measured": 9
              },
              {
                "season": "2023",
                "shareOfSquadMinutes": 0.30227073647328345,
                "intake": 10,
                "measured": 10
              },
              {
                "season": "2024",
                "shareOfSquadMinutes": 0.15252525252525254,
                "intake": 8,
                "measured": 8
              },
              {
                "season": "2025",
                "shareOfSquadMinutes": 0.11289389236677363,
                "intake": 8,
                "measured": 8
              }
            ],
            "minuteShares": {
              "n": 10,
              "freshman": 16.7,
              "newcomer": 19.1,
              "returning": 64.2
            },
            "spread": 7.21168310661269,
            "step": -9.620132458326097,
            "coach": "Sasho Cirovski",
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
                "median": 1328,
                "low": 883,
                "high": 1644,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 683,
                "low": 604,
                "high": 850,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 3,
                "median": 407,
                "low": 311,
                "high": 777,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 4,
                "median": 246,
                "low": 154,
                "high": 693,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 5,
                "median": 109,
                "low": 18,
                "high": 295,
                "band": "fringe",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 6,
                "median": 75,
                "low": 0,
                "high": 277,
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
            "programmeMedian": 1328,
            "programmeSpread": {
              "low": 883,
              "high": 1644,
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
              "n": 35,
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
          "kind": "POSTSEASON_RESULT",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "round": "r16"
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
            "recentWinPct": 0.64,
            "priorWinPct": 0.5
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
            "coach": "Sasho Cirovski",
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
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
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
                "coach": "Sasho Cirovski"
              }
            },
            "comparison": null
          }
        }
      ]
    }
  },
  "Portland": {
    "programme": {
      "resolved": true
    },
    "summary": {
      "reasonCount": 3,
      "hasPositiveReasons": true,
      "openingIdentified": true,
      "hasEvidence": true,
      "evidenceCount": 15,
      "sectionCounts": {
        "ROSTER_OPPORTUNITY": 3,
        "RECRUITMENT_PATHWAY": 7,
        "DEVELOPMENT": 3,
        "ACADEMIC_PROGRAMME_FIT": 1,
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
            "projectedMinutes": 4332,
            "beforeClassYear": 2027,
            "byYear": [
              {
                "year": 2026,
                "minutes": 0,
                "players": 0
              },
              {
                "year": 2027,
                "minutes": 4332,
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
          "kind": "COACH_ARRIVAL_SAME_COUNTRY",
          "decisionClass": "PATHWAY",
          "polarity": "POSITIVE",
          "category": "international",
          "facts": {
            "country": "New Zealand",
            "coach": "Nick Carlin-Voigt",
            "position": "DEFENSE",
            "count": 1,
            "seasons": [
              "2023"
            ],
            "namedArrival": "Boyd Curry",
            "namedArrivalSeason": "2023",
            "attributableIntakes": 4,
            "intakesWithArrival": 1,
            "arrivals": [
              {
                "player": "Boyd Curry",
                "season": "2023",
                "country": "New Zealand",
                "region": "OCEANIA",
                "position": "DEFENSE",
                "coach": "Nick Carlin-Voigt",
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
                "country": "New Zealand",
                "coach": "Nick Carlin-Voigt",
                "position": "DEFENSE"
              }
            },
            "comparison": null
          }
        },
        "supporting": [
          {
            "kind": "ARRIVAL_SAME_COUNTRY_POSITION",
            "decisionClass": "PATHWAY",
            "polarity": "POSITIVE",
            "category": "international",
            "facts": {
              "country": "New Zealand",
              "position": "DEFENSE",
              "count": 1,
              "seasons": [
                "2023"
              ],
              "namedArrival": "Boyd Curry",
              "namedArrivalSeason": "2023",
              "observedIntakes": 4,
              "intakesWithArrival": 1,
              "arrivals": [
                {
                  "player": "Boyd Curry",
                  "season": "2023",
                  "country": "New Zealand",
                  "region": "OCEANIA",
                  "position": "DEFENSE",
                  "coach": "Nick Carlin-Voigt",
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
                  "country": "New Zealand",
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
              "count": 2,
              "names": [
                "Jaylen Rodwell",
                "Boyd Curry"
              ],
              "seasonsPresent": [
                "2022",
                "2023"
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
              "season": "2022-2023",
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
                "n": 2,
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
          "kind": "POSTSEASON_RESULT",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "round": "r16"
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
            "projectedMinutes": 4332,
            "beforeClassYear": 2027,
            "byYear": [
              {
                "year": 2026,
                "minutes": 0,
                "players": 0
              },
              {
                "year": 2027,
                "minutes": 4332,
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
            "count": 10,
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
            "total": 1,
            "starters": 1,
            "names": [
              "Miguel-Angel Hernandez"
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
            "coach": "Nick Carlin-Voigt",
            "position": "DEFENSE",
            "count": 1,
            "seasons": [
              "2023"
            ],
            "namedArrival": "Boyd Curry",
            "namedArrivalSeason": "2023",
            "attributableIntakes": 4,
            "intakesWithArrival": 1,
            "arrivals": [
              {
                "player": "Boyd Curry",
                "season": "2023",
                "country": "New Zealand",
                "region": "OCEANIA",
                "position": "DEFENSE",
                "coach": "Nick Carlin-Voigt",
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
                "country": "New Zealand",
                "coach": "Nick Carlin-Voigt",
                "position": "DEFENSE"
              }
            },
            "comparison": null
          }
        },
        {
          "kind": "ARRIVAL_SAME_COUNTRY_POSITION",
          "decisionClass": "PATHWAY",
          "polarity": "POSITIVE",
          "category": "international",
          "facts": {
            "country": "New Zealand",
            "position": "DEFENSE",
            "count": 1,
            "seasons": [
              "2023"
            ],
            "namedArrival": "Boyd Curry",
            "namedArrivalSeason": "2023",
            "observedIntakes": 4,
            "intakesWithArrival": 1,
            "arrivals": [
              {
                "player": "Boyd Curry",
                "season": "2023",
                "country": "New Zealand",
                "region": "OCEANIA",
                "position": "DEFENSE",
                "coach": "Nick Carlin-Voigt",
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
                "country": "New Zealand",
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
            "count": 2,
            "names": [
              "Jaylen Rodwell",
              "Boyd Curry"
            ],
            "seasonsPresent": [
              "2022",
              "2023"
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
            "season": "2022-2023",
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
              "n": 2,
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
            "count": 15,
            "seasons": [
              "2023",
              "2024",
              "2025",
              "2026"
            ],
            "observedIntakes": 4,
            "intakesWithArrival": 4,
            "meanPerIntake": 3.75,
            "byIntake": {
              "2022->2023": 2,
              "2023->2024": 4,
              "2024->2025": 6,
              "2025->2026": 3
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
              "n": 15,
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
            "count": 6,
            "countries": [
              "Canada",
              "Denmark",
              "Jamaica",
              "Sweden"
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
            "count": 6,
            "squadSize": 33,
            "share": 0.18
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
                "median": 0,
                "low": 0,
                "high": 104,
                "band": "none",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 2,
                "median": 0,
                "low": 0,
                "high": 0,
                "band": "none",
                "agreement": "tight",
                "seasonsWithThisMany": 1
              },
              {
                "rank": 3,
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
            "players": 6,
            "seasonsObserved": 3
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "MEDIUM",
            "confidenceBeforeFreshness": null,
            "freshness": null,
            "season": "2022, 2023, 2025",
            "source": "roster_players:freshman-minutes",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2023",
                "2025"
              ],
              "seasonsUnread": null,
              "n": 6,
              "cohort": {
                "position": "DEFENSE",
                "origin": null
              }
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
                "median": 0,
                "low": 0,
                "high": 571,
                "band": "none",
                "agreement": "wide",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 2,
                "median": 0,
                "low": 0,
                "high": 104,
                "band": "none",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 3,
                "median": 0,
                "low": 0,
                "high": 67,
                "band": "none",
                "agreement": "tight",
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
              },
              {
                "rank": 5,
                "median": 0,
                "low": 0,
                "high": 0,
                "band": "none",
                "agreement": "tight",
                "seasonsWithThisMany": 2
              },
              {
                "rank": 6,
                "median": 0,
                "low": 0,
                "high": 0,
                "band": "none",
                "agreement": "tight",
                "seasonsWithThisMany": 1
              }
            ],
            "seasonsObserved": 3,
            "medianIntake": 8,
            "medianPlayed": 0,
            "seasonsWithAnImpactFreshman": 0
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "MEDIUM",
            "confidenceBeforeFreshness": null,
            "freshness": null,
            "season": "2022, 2023, 2025",
            "source": "roster_players:freshman-minutes",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2023",
                "2025"
              ],
              "seasonsUnread": [
                "2024"
              ],
              "n": 23,
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
            "programmeMedian": 0,
            "programmeSpread": {
              "low": 0,
              "high": 571,
              "agreement": "wide"
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
            "confidence": "MEDIUM",
            "confidenceBeforeFreshness": null,
            "freshness": null,
            "season": "2022, 2023, 2024, 2025",
            "source": "roster_players:pool-benchmarks",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2023",
                "2025"
              ],
              "seasonsUnread": [
                "2024"
              ],
              "n": 23,
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
          "kind": "POSTSEASON_RESULT",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "round": "r16"
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
            "coach": "Nick Carlin-Voigt",
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
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
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
                "coach": "Nick Carlin-Voigt"
              }
            },
            "comparison": null
          }
        }
      ]
    }
  },
  "Denver": {
    "programme": {
      "resolved": true
    },
    "summary": {
      "reasonCount": 3,
      "hasPositiveReasons": true,
      "openingIdentified": true,
      "hasEvidence": true,
      "evidenceCount": 20,
      "sectionCounts": {
        "ROSTER_OPPORTUNITY": 4,
        "RECRUITMENT_PATHWAY": 8,
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
            "count": 1,
            "names": [
              "Collin Keller"
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
            "kind": "ELIGIBILITY_CLIFF",
            "decisionClass": "OPENING",
            "polarity": "POSITIVE",
            "category": "roster",
            "facts": {
              "position": "DEFENSE",
              "players": 2,
              "projectedMinutes": 44,
              "beforeClassYear": 2027,
              "byYear": [
                {
                  "year": 2026,
                  "minutes": 44,
                  "players": 1
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
          "kind": "COACH_ARRIVAL_SAME_COUNTRY",
          "decisionClass": "PATHWAY",
          "polarity": "POSITIVE",
          "category": "international",
          "facts": {
            "country": "New Zealand",
            "coach": "Jamie Franks",
            "position": null,
            "count": 2,
            "seasons": [
              "2024",
              "2026"
            ],
            "namedArrival": null,
            "namedArrivalSeason": null,
            "attributableIntakes": 4,
            "intakesWithArrival": 2,
            "arrivals": [
              {
                "player": "Keegan Kelly",
                "season": "2024",
                "country": "New Zealand",
                "region": "OCEANIA",
                "position": "FORWARD",
                "coach": "Jamie Franks",
                "coachAttribution": "ATTRIBUTED"
              },
              {
                "player": "Ryan Mackay",
                "season": "2026",
                "country": "New Zealand",
                "region": "OCEANIA",
                "position": "DEFENSE",
                "coach": "Jamie Franks",
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
            "season": "2024-2026",
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
              "n": 2,
              "cohort": {
                "country": "New Zealand",
                "coach": "Jamie Franks",
                "position": null
              }
            },
            "comparison": null
          }
        },
        "supporting": [
          {
            "kind": "ARRIVAL_SAME_COUNTRY_POSITION",
            "decisionClass": "PATHWAY",
            "polarity": "POSITIVE",
            "category": "international",
            "facts": {
              "country": "New Zealand",
              "position": "DEFENSE",
              "count": 1,
              "seasons": [
                "2026"
              ],
              "namedArrival": "Ryan Mackay",
              "namedArrivalSeason": "2026",
              "observedIntakes": 4,
              "intakesWithArrival": 1,
              "arrivals": [
                {
                  "player": "Ryan Mackay",
                  "season": "2026",
                  "country": "New Zealand",
                  "region": "OCEANIA",
                  "position": "DEFENSE",
                  "coach": "Jamie Franks",
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
                  "country": "New Zealand",
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
              "count": 3,
              "names": [
                "Ronan Wynne",
                "Keegan Kelly",
                "Ryan Mackay"
              ],
              "seasonsPresent": [
                "2022",
                "2023",
                "2024",
                "2025",
                "2026"
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
              "season": "2022-2026",
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
                "n": 3,
                "cohort": {
                  "country": "New Zealand"
                }
              },
              "comparison": null
            }
          },
          {
            "kind": "CURRENT_SAME_COUNTRY",
            "decisionClass": "PATHWAY",
            "polarity": "POSITIVE",
            "category": "international",
            "facts": {
              "country": "New Zealand",
              "count": 2,
              "names": [
                "Keegan Kelly",
                "Ryan Mackay"
              ]
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
        "decisionClass": "PATHWAY",
        "category": "international",
        "dedupeGroup": "international-connection",
        "section": "RECRUITMENT_PATHWAY"
      },
      {
        "primary": {
          "kind": "CONFERENCE_TITLE",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "conference": "Summit League"
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
              "round": "r32"
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
              "classification": "STRONG",
              "recentWinPct": 0.66,
              "priorWinPct": 0.7
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
            "count": 1,
            "names": [
              "Collin Keller"
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
          "kind": "ELIGIBILITY_CLIFF",
          "decisionClass": "OPENING",
          "polarity": "POSITIVE",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "players": 2,
            "projectedMinutes": 44,
            "beforeClassYear": 2027,
            "byYear": [
              {
                "year": 2026,
                "minutes": 44,
                "players": 1
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
            "count": 8,
            "squadSize": 28
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
              "David Biggers",
              "Holger Olsson",
              "Kyle McGowan",
              "Bryce Willoughby",
              "Collin Keller",
              "Dean Kelliher"
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
            "coach": "Jamie Franks",
            "position": null,
            "count": 2,
            "seasons": [
              "2024",
              "2026"
            ],
            "namedArrival": null,
            "namedArrivalSeason": null,
            "attributableIntakes": 4,
            "intakesWithArrival": 2,
            "arrivals": [
              {
                "player": "Keegan Kelly",
                "season": "2024",
                "country": "New Zealand",
                "region": "OCEANIA",
                "position": "FORWARD",
                "coach": "Jamie Franks",
                "coachAttribution": "ATTRIBUTED"
              },
              {
                "player": "Ryan Mackay",
                "season": "2026",
                "country": "New Zealand",
                "region": "OCEANIA",
                "position": "DEFENSE",
                "coach": "Jamie Franks",
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
            "season": "2024-2026",
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
              "n": 2,
              "cohort": {
                "country": "New Zealand",
                "coach": "Jamie Franks",
                "position": null
              }
            },
            "comparison": null
          }
        },
        {
          "kind": "ARRIVAL_SAME_COUNTRY_POSITION",
          "decisionClass": "PATHWAY",
          "polarity": "POSITIVE",
          "category": "international",
          "facts": {
            "country": "New Zealand",
            "position": "DEFENSE",
            "count": 1,
            "seasons": [
              "2026"
            ],
            "namedArrival": "Ryan Mackay",
            "namedArrivalSeason": "2026",
            "observedIntakes": 4,
            "intakesWithArrival": 1,
            "arrivals": [
              {
                "player": "Ryan Mackay",
                "season": "2026",
                "country": "New Zealand",
                "region": "OCEANIA",
                "position": "DEFENSE",
                "coach": "Jamie Franks",
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
                "country": "New Zealand",
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
            "count": 3,
            "names": [
              "Ronan Wynne",
              "Keegan Kelly",
              "Ryan Mackay"
            ],
            "seasonsPresent": [
              "2022",
              "2023",
              "2024",
              "2025",
              "2026"
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
            "season": "2022-2026",
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
              "n": 3,
              "cohort": {
                "country": "New Zealand"
              }
            },
            "comparison": null
          }
        },
        {
          "kind": "CURRENT_SAME_COUNTRY",
          "decisionClass": "PATHWAY",
          "polarity": "POSITIVE",
          "category": "international",
          "facts": {
            "country": "New Zealand",
            "count": 2,
            "names": [
              "Keegan Kelly",
              "Ryan Mackay"
            ]
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
          "kind": "POSITION_INTAKE_HISTORY",
          "decisionClass": "CONTEXT",
          "polarity": "NEUTRAL",
          "category": "internal",
          "facts": {
            "position": "DEFENSE",
            "count": 12,
            "seasons": [
              "2023",
              "2024",
              "2025",
              "2026"
            ],
            "observedIntakes": 4,
            "intakesWithArrival": 4,
            "meanPerIntake": 3,
            "byIntake": {
              "2022->2023": 2,
              "2023->2024": 5,
              "2024->2025": 4,
              "2025->2026": 1
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
              "n": 12,
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
            "arrivals": 1,
            "atPosition": 0,
            "squadSize": 28
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
            "count": 3,
            "countries": [
              "New Zealand",
              "Sweden"
            ],
            "uniqueCountries": 2
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
            "count": 3,
            "squadSize": 28,
            "share": 0.11
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
                "median": 722,
                "low": 0,
                "high": 1392,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 0,
                "low": 0,
                "high": 354,
                "band": "none",
                "agreement": "wide",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 3,
                "median": 45,
                "low": 0,
                "high": 89,
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
                "seasonsWithThisMany": 2
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
            "refused": "DEFENSE / international: only 1 in 1 season — too few to read separately",
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
            "players": 34,
            "shareBySeason": [
              {
                "season": "2022",
                "shareOfSquadMinutes": 0.17306815071617554,
                "intake": 12,
                "measured": 12
              },
              {
                "season": "2023",
                "shareOfSquadMinutes": 0.09423874481586969,
                "intake": 6,
                "measured": 6
              },
              {
                "season": "2024",
                "shareOfSquadMinutes": 0.036999956470639445,
                "intake": 7,
                "measured": 7
              },
              {
                "season": "2025",
                "shareOfSquadMinutes": 0.046343460069128616,
                "intake": 9,
                "measured": 9
              }
            ],
            "minuteShares": {
              "n": 12,
              "freshman": 5.7,
              "newcomer": 0.9,
              "returning": 93.4
            },
            "spread": 5.3877937385771775,
            "step": -9.198173949613857,
            "coach": "Jamie Franks",
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
                "median": 1121,
                "low": 576,
                "high": 1860,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 380,
                "low": 0,
                "high": 867,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 3,
                "median": 89,
                "low": 0,
                "high": 601,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 4,
                "median": 0,
                "low": 0,
                "high": 466,
                "band": "none",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 5,
                "median": 0,
                "low": 0,
                "high": 0,
                "band": "none",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 6,
                "median": 0,
                "low": 0,
                "high": 0,
                "band": "none",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              }
            ],
            "seasonsObserved": 4,
            "medianIntake": 8,
            "medianPlayed": 3,
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
              "n": 34,
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
            "programmeMedian": 1121,
            "programmeSpread": {
              "low": 576,
              "high": 1860,
              "agreement": "tight"
            },
            "pool": {
              "n": 770,
              "p25": 901,
              "median": 1118,
              "p75": 1289
            },
            "band": "median-to-p75"
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
              "n": 34,
              "cohort": null
            },
            "comparison": {
              "basis": "mens-soccer programmes with a readable freshman ladder, 2022-2023-2024-2025",
              "statistic": "ladder-rank-1-median-minutes",
              "poolSize": 920,
              "percentile": null,
              "band": "median-to-p75"
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
            "conference": "Summit League"
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
            "round": "r32"
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
            "classification": "STRONG",
            "recentWinPct": 0.66,
            "priorWinPct": 0.7
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
            "coach": "Jamie Franks",
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
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
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
                "coach": "Jamie Franks"
              }
            },
            "comparison": null
          }
        }
      ]
    }
  },
  "Duke": {
    "programme": {
      "resolved": true
    },
    "summary": {
      "reasonCount": 3,
      "hasPositiveReasons": true,
      "openingIdentified": true,
      "hasEvidence": true,
      "evidenceCount": 14,
      "sectionCounts": {
        "ROSTER_OPPORTUNITY": 4,
        "RECRUITMENT_PATHWAY": 4,
        "DEVELOPMENT": 4,
        "ACADEMIC_PROGRAMME_FIT": 1,
        "PROGRAMME_CONTEXT": 1
      }
    },
    "topReasons": [
      {
        "primary": {
          "kind": "POSITION_GROUP_SCARCITY",
          "decisionClass": "OPENING",
          "polarity": "POSITIVE",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "count": 5,
            "squadSize": 28,
            "share": 0.18
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
        },
        "supporting": [],
        "decisionClass": "OPENING",
        "category": "roster",
        "dedupeGroup": "position-depth",
        "section": "ROSTER_OPPORTUNITY"
      },
      {
        "primary": {
          "kind": "ELIGIBILITY_CLIFF",
          "decisionClass": "OPENING",
          "polarity": "POSITIVE",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "players": 1,
            "projectedMinutes": 1042,
            "beforeClassYear": 2027,
            "byYear": [
              {
                "year": 2026,
                "minutes": 0,
                "players": 0
              },
              {
                "year": 2027,
                "minutes": 1042,
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
        "supporting": [],
        "decisionClass": "OPENING",
        "category": "roster",
        "dedupeGroup": "position-opportunity",
        "section": "ROSTER_OPPORTUNITY"
      },
      {
        "primary": {
          "kind": "POSTSEASON_RESULT",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "round": "r16"
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
          "kind": "POSITION_GROUP_SCARCITY",
          "decisionClass": "OPENING",
          "polarity": "POSITIVE",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "count": 5,
            "squadSize": 28,
            "share": 0.18
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
        },
        {
          "kind": "ELIGIBILITY_CLIFF",
          "decisionClass": "OPENING",
          "polarity": "POSITIVE",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "players": 1,
            "projectedMinutes": 1042,
            "beforeClassYear": 2027,
            "byYear": [
              {
                "year": 2026,
                "minutes": 0,
                "players": 0
              },
              {
                "year": 2027,
                "minutes": 1042,
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
            "count": 5,
            "squadSize": 28
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
            "total": 1,
            "starters": 0,
            "names": [
              "Colin Gallagher"
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
            "count": 6,
            "seasons": [
              "2024",
              "2025",
              "2026"
            ],
            "observedIntakes": 4,
            "intakesWithArrival": 3,
            "meanPerIntake": 1.5,
            "byIntake": {
              "2022->2023": 0,
              "2023->2024": 2,
              "2024->2025": 3,
              "2025->2026": 1
            }
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": null,
            "season": "2024-2026",
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
              "n": 6,
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
            "arrivals": 3,
            "atPosition": 0,
            "squadSize": 28
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
            "count": 10,
            "countries": [
              "Germany",
              "Ghana",
              "Iceland",
              "Japan",
              "Norway",
              "United Kingdom"
            ],
            "uniqueCountries": 6
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
            "count": 10,
            "squadSize": 28,
            "share": 0.36
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
                "median": 1008,
                "low": 164,
                "high": 1270,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 76,
                "low": 0,
                "high": 746,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 3
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
            "players": 7,
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
              "n": 7,
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
            "verdictKey": "policy-shift-same-coach",
            "verdictNote": "the same coach, but the recent seasons look different from the early ones — weight the recent ones",
            "seasonsObserved": 4,
            "players": 28,
            "shareBySeason": [
              {
                "season": "2022",
                "shareOfSquadMinutes": 0.28182882691079414,
                "intake": 10,
                "measured": 10
              },
              {
                "season": "2023",
                "shareOfSquadMinutes": 0.20120514927417146,
                "intake": 5,
                "measured": 5
              },
              {
                "season": "2024",
                "shareOfSquadMinutes": 0.0945318184362232,
                "intake": 5,
                "measured": 5
              },
              {
                "season": "2025",
                "shareOfSquadMinutes": 0.1659839174632074,
                "intake": 8,
                "measured": 8
              }
            ],
            "minuteShares": {
              "n": 12,
              "freshman": 19.3,
              "newcomer": 29.9,
              "returning": 50.8
            },
            "spread": 6.741917705751602,
            "step": -11.12591201427675,
            "coach": "John Kerr",
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
                "median": 1382,
                "low": 964,
                "high": 1687,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 1105,
                "low": 500,
                "high": 1270,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 3,
                "median": 835,
                "low": 164,
                "high": 1092,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 4,
                "median": 86,
                "low": 0,
                "high": 1054,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 5,
                "median": 37,
                "low": 0,
                "high": 211,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 6,
                "median": 39,
                "low": 1,
                "high": 76,
                "band": "fringe",
                "agreement": "tight",
                "seasonsWithThisMany": 2
              }
            ],
            "seasonsObserved": 4,
            "medianIntake": 7,
            "medianPlayed": 5,
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
              "n": 28,
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
            "programmeMedian": 1382,
            "programmeSpread": {
              "low": 964,
              "high": 1687,
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
              "n": 28,
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
          "kind": "POSTSEASON_RESULT",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "round": "r16"
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
            "coach": "John Kerr",
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
              "state": "CURRENT",
              "ageDays": 7,
              "reason": null
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
                "coach": "John Kerr"
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
  "Notre Dame": {
    "programme": {
      "resolved": true
    },
    "summary": {
      "reasonCount": 1,
      "hasPositiveReasons": true,
      "openingIdentified": false,
      "hasEvidence": true,
      "evidenceCount": 2,
      "sectionCounts": {
        "ROSTER_OPPORTUNITY": 0,
        "RECRUITMENT_PATHWAY": 0,
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
            "round": "r32"
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "STATIC",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "UNKNOWN",
              "ageDays": null,
              "reason": "no scrape date on these roster rows"
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
      "ROSTER_OPPORTUNITY": [],
      "RECRUITMENT_PATHWAY": [],
      "DEVELOPMENT": [],
      "ACADEMIC_PROGRAMME_FIT": [
        {
          "kind": "POSTSEASON_RESULT",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "round": "r32"
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "STATIC",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": {
              "state": "UNKNOWN",
              "ageDays": null,
              "reason": "no scrape date on these roster rows"
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
            "coach": "Chad Riley",
            "seasonsObserved": 2,
            "since": 2024,
            "windowBounded": true,
            "knownThrough": 2025,
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
            "season": "2024-2025",
            "source": "coach_seasons",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2024",
                "2025"
              ],
              "seasonsUnread": [
                "2022",
                "2023",
                "2026"
              ],
              "n": 2,
              "cohort": {
                "coach": "Chad Riley"
              }
            },
            "comparison": null
          }
        }
      ]
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
  }
};
