/**
 * Real ACADEMIC_PROGRAMME_FIT payloads, captured from the operator endpoint.
 *
 * Between them these cover every combination the section has to hold: academic
 * fit alone, programme performance alone, all four together, each momentum
 * classification, several postseason rounds including a title win, and a
 * programme with nothing in the section at all.
 */
export const FIT_FIXTURES = {
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
  "High Point": {
    "programme": {
      "resolved": true
    },
    "summary": {
      "reasonCount": 4,
      "hasPositiveReasons": true,
      "openingIdentified": true,
      "hasEvidence": true,
      "evidenceCount": 18,
      "sectionCounts": {
        "ROSTER_OPPORTUNITY": 4,
        "RECRUITMENT_PATHWAY": 5,
        "DEVELOPMENT": 4,
        "ACADEMIC_PROGRAMME_FIT": 4,
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
              "Lucas Kelly"
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
              "players": 3,
              "projectedMinutes": 1762,
              "beforeClassYear": 2027,
              "byYear": [
                {
                  "year": 2026,
                  "minutes": 0,
                  "players": 1
                },
                {
                  "year": 2027,
                  "minutes": 1762,
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
              "Chris Niblock"
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
            "season": "2024-2025",
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
          "kind": "CONFERENCE_TITLE",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "conference": "Big South"
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
              "classification": "RISING",
              "recentWinPct": 0.73,
              "priorWinPct": 0.61
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
              "Lucas Kelly"
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
            "players": 3,
            "projectedMinutes": 1762,
            "beforeClassYear": 2027,
            "byYear": [
              {
                "year": 2026,
                "minutes": 0,
                "players": 1
              },
              {
                "year": 2027,
                "minutes": 1762,
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
            "count": 7,
            "squadSize": 27
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
            "total": 3,
            "starters": 1,
            "names": [
              "Josh Caron",
              "Lucas Kelly",
              "Noah Joseph"
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
              "Chris Niblock"
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
            "season": "2024-2025",
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
            "count": 17,
            "seasons": [
              "2023",
              "2024",
              "2025",
              "2026"
            ],
            "observedIntakes": 4,
            "intakesWithArrival": 4,
            "meanPerIntake": 4.25,
            "byIntake": {
              "2022->2023": 3,
              "2023->2024": 8,
              "2024->2025": 3,
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
              "n": 17,
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
            "squadSize": 27
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
            "count": 5,
            "countries": [
              "Bosnia and Herzegovina",
              "Brazil",
              "Ghana"
            ],
            "uniqueCountries": 3
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
            "count": 5,
            "squadSize": 27,
            "share": 0.19
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
                "median": 301,
                "low": 0,
                "high": 684,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 0,
                "low": 0,
                "high": 554,
                "band": "none",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 3,
                "median": 109,
                "low": 0,
                "high": 217,
                "band": "fringe",
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
            "refused": "DEFENSE / international: only 2 in 2 seasons — too few to read separately",
            "relaxed": "DEFENSE",
            "players": 10,
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
              "n": 10,
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
            "players": 27,
            "shareBySeason": [
              {
                "season": "2022",
                "shareOfSquadMinutes": 0.20789405349259932,
                "intake": 8,
                "measured": 8
              },
              {
                "season": "2023",
                "shareOfSquadMinutes": 0.06419710741439433,
                "intake": 4,
                "measured": 4
              },
              {
                "season": "2024",
                "shareOfSquadMinutes": 0.12020781082049445,
                "intake": 10,
                "measured": 10
              },
              {
                "season": "2025",
                "shareOfSquadMinutes": 0.06384805778653331,
                "intake": 5,
                "measured": 5
              }
            ],
            "minuteShares": {
              "n": 10,
              "freshman": 8.6,
              "newcomer": 24.9,
              "returning": 66.5
            },
            "spread": 5.884337305447176,
            "step": -4.401764614998296,
            "coach": "Zach Haines",
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
                "median": 939,
                "low": 718,
                "high": 1339,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 624,
                "low": 178,
                "high": 1192,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 3,
                "median": 127,
                "low": 0,
                "high": 684,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 4,
                "median": 35,
                "low": 0,
                "high": 554,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 5,
                "median": 56,
                "low": 0,
                "high": 217,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 3
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
            "medianIntake": 7,
            "medianPlayed": 4,
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
              "n": 27,
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
            "programmeMedian": 939,
            "programmeSpread": {
              "low": 718,
              "high": 1339,
              "agreement": "tight"
            },
            "pool": {
              "n": 770,
              "p25": 901,
              "median": 1118,
              "p75": 1289
            },
            "band": "p25-to-median"
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
              "n": 27,
              "cohort": null
            },
            "comparison": {
              "basis": "mens-soccer programmes with a readable freshman ladder, 2022-2023-2024-2025",
              "statistic": "ladder-rank-1-median-minutes",
              "poolSize": 920,
              "percentile": null,
              "band": "p25-to-median"
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
          "kind": "CONFERENCE_TITLE",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "conference": "Big South"
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
            "classification": "RISING",
            "recentWinPct": 0.73,
            "priorWinPct": 0.61
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
            "coach": "Zach Haines",
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
                "coach": "Zach Haines"
              }
            },
            "comparison": null
          }
        }
      ]
    }
  },
  "Georgetown": {
    "programme": {
      "resolved": true
    },
    "summary": {
      "reasonCount": 4,
      "hasPositiveReasons": true,
      "openingIdentified": true,
      "hasEvidence": true,
      "evidenceCount": 11,
      "sectionCounts": {
        "ROSTER_OPPORTUNITY": 3,
        "RECRUITMENT_PATHWAY": 4,
        "DEVELOPMENT": 0,
        "ACADEMIC_PROGRAMME_FIT": 3,
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
              "Mitchell Baker"
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
          "kind": "ELIGIBILITY_CLIFF",
          "decisionClass": "OPENING",
          "polarity": "POSITIVE",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "players": 1,
            "projectedMinutes": 1292,
            "beforeClassYear": 2027,
            "byYear": [
              {
                "year": 2027,
                "minutes": 1292,
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
          "kind": "CONFERENCE_TITLE",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "conference": "Big East"
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
              "classification": "STRONG",
              "recentWinPct": 0.65,
              "priorWinPct": 0.68
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
            "projectedMinutes": 1292,
            "beforeClassYear": 2027,
            "byYear": [
              {
                "year": 2027,
                "minutes": 1292,
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
              "Mitchell Baker"
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
            "count": 5,
            "seasons": [
              "2023",
              "2024",
              "2025",
              "2026"
            ],
            "observedIntakes": 4,
            "intakesWithArrival": 4,
            "meanPerIntake": 1.25,
            "byIntake": {
              "2022->2023": 1,
              "2023->2024": 1,
              "2024->2025": 2,
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
              "n": 5,
              "cohort": {
                "position": "DEFENSE"
              }
            },
            "comparison": null
          }
        },
        {
          "kind": "INTERNATIONAL_ROSTER",
          "decisionClass": "CONTEXT",
          "polarity": "POSITIVE",
          "category": "international",
          "facts": {
            "count": 8,
            "countries": [
              "Australia",
              "Canada",
              "Ghana",
              "Greece",
              "Poland",
              "Ukraine",
              "United Kingdom"
            ],
            "uniqueCountries": 7
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
            "count": 8,
            "squadSize": 28,
            "share": 0.29
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
      "DEVELOPMENT": [],
      "ACADEMIC_PROGRAMME_FIT": [
        {
          "kind": "CONFERENCE_TITLE",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "conference": "Big East"
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
            "classification": "STRONG",
            "recentWinPct": 0.65,
            "priorWinPct": 0.68
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
            "coach": "Brian Wiese",
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
                "coach": "Brian Wiese"
              }
            },
            "comparison": null
          }
        }
      ]
    }
  },
  "Washington": {
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
        "ROSTER_OPPORTUNITY": 5,
        "RECRUITMENT_PATHWAY": 2,
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
              "Egor Akulov"
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
                "Egor Akulov"
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
              "players": 2,
              "projectedMinutes": 4106,
              "beforeClassYear": 2027,
              "byYear": [
                {
                  "year": 2026,
                  "minutes": 2124,
                  "players": 1
                },
                {
                  "year": 2027,
                  "minutes": 1982,
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
          "kind": "POSTSEASON_RESULT",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "round": "champion"
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
          "kind": "POSITION_GRADUATION",
          "decisionClass": "OPENING",
          "polarity": "POSITIVE",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "count": 1,
            "names": [
              "Egor Akulov"
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
              "Egor Akulov"
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
            "players": 2,
            "projectedMinutes": 4106,
            "beforeClassYear": 2027,
            "byYear": [
              {
                "year": 2026,
                "minutes": 2124,
                "players": 1
              },
              {
                "year": 2027,
                "minutes": 1982,
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
            "total": 5,
            "starters": 2,
            "names": [
              "Stockton Short",
              "Egor Akulov",
              "Nick O'Brien",
              "Cameron Cruz",
              "Wyatt Lewis"
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
            "count": 11,
            "seasons": [
              "2023",
              "2024",
              "2025",
              "2026"
            ],
            "observedIntakes": 4,
            "intakesWithArrival": 4,
            "meanPerIntake": 2.75,
            "byIntake": {
              "2022->2023": 3,
              "2023->2024": 3,
              "2024->2025": 2,
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
              "n": 11,
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
            "atPosition": 0,
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
                "median": 215,
                "low": 0,
                "high": 531,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
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
            "refused": "DEFENSE / international: only 0 in 0 seasons — too few to read separately",
            "relaxed": "DEFENSE",
            "players": 6,
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
          "kind": "PROGRAMME_DEVELOPMENT_PATTERN",
          "decisionClass": "FIT",
          "polarity": "NEUTRAL",
          "category": "development",
          "facts": {
            "verdictKey": "steady",
            "verdictNote": "one coach, a consistent pattern — every season counts and the record is as firm as this gets",
            "seasonsObserved": 4,
            "players": 29,
            "shareBySeason": [
              {
                "season": "2022",
                "shareOfSquadMinutes": 0.0342998585572843,
                "intake": 11,
                "measured": 11
              },
              {
                "season": "2023",
                "shareOfSquadMinutes": 0.03810753170950724,
                "intake": 6,
                "measured": 6
              },
              {
                "season": "2024",
                "shareOfSquadMinutes": 0.059532780708364735,
                "intake": 7,
                "measured": 7
              },
              {
                "season": "2025",
                "shareOfSquadMinutes": 0.08219349981177061,
                "intake": 5,
                "measured": 5
              }
            ],
            "minuteShares": {
              "n": 12,
              "freshman": 4.7,
              "newcomer": 10.2,
              "returning": 85.1
            },
            "spread": 1.9139490713232108,
            "step": 3.4659445126671904,
            "coach": "Jamie Clark",
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
                "median": 687,
                "low": 347,
                "high": 872,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 402,
                "low": 0,
                "high": 531,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 3,
                "median": 49,
                "low": 0,
                "high": 364,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 4,
                "median": 0,
                "low": 0,
                "high": 198,
                "band": "none",
                "agreement": "tight",
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
                "seasonsWithThisMany": 3
              }
            ],
            "seasonsObserved": 4,
            "medianIntake": 7,
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
            "programmeMedian": 687,
            "programmeSpread": {
              "low": 347,
              "high": 872,
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
      "ACADEMIC_PROGRAMME_FIT": [
        {
          "kind": "POSTSEASON_RESULT",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "round": "champion"
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
            "coach": "Jamie Clark",
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
                "coach": "Jamie Clark"
              }
            },
            "comparison": null
          }
        }
      ]
    }
  },
  "SMU": {
    "programme": {
      "resolved": true
    },
    "summary": {
      "reasonCount": 3,
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
            "count": 2,
            "names": [
              "Enzo Panozzo",
              "Owen Zarnick"
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
                "Enzo Panozzo",
                "Owen Zarnick"
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
              "players": 3,
              "projectedMinutes": 4021,
              "beforeClassYear": 2027,
              "byYear": [
                {
                  "year": 2026,
                  "minutes": 2236,
                  "players": 2
                },
                {
                  "year": 2027,
                  "minutes": 1785,
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
          "kind": "CONFERENCE_TITLE",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "conference": "ACC"
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
            "count": 2,
            "names": [
              "Enzo Panozzo",
              "Owen Zarnick"
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
              "Enzo Panozzo",
              "Owen Zarnick"
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
            "players": 3,
            "projectedMinutes": 4021,
            "beforeClassYear": 2027,
            "byYear": [
              {
                "year": 2026,
                "minutes": 2236,
                "players": 2
              },
              {
                "year": 2027,
                "minutes": 1785,
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
            "count": 12,
            "squadSize": 32
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
            "starters": 3,
            "names": [
              "Alex Salvo",
              "Enzo Panozzo",
              "Owen Zarnick",
              "Micah Ramirez"
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
              "2022->2023": 3,
              "2023->2024": 6,
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
            "arrivals": 8,
            "atPosition": 2,
            "squadSize": 32
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
              "Argentina",
              "Denmark",
              "Ghana",
              "Spain",
              "Uganda"
            ],
            "uniqueCountries": 5
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
            "squadSize": 32,
            "share": 0.19
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
                "median": 1066,
                "low": 0,
                "high": 1151,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 2,
                "median": 440,
                "low": 0,
                "high": 880,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 2
              },
              {
                "rank": 3,
                "median": 136,
                "low": 136,
                "high": 136,
                "band": "fringe",
                "agreement": "tight",
                "seasonsWithThisMany": 1
              },
              {
                "rank": 4,
                "median": 0,
                "low": 0,
                "high": 0,
                "band": "none",
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
              "position": null,
              "origin": "international",
              "applied": true
            },
            "asked": {
              "position": "DEFENSE",
              "origin": "international"
            },
            "refused": "DEFENSE / international: only 2 in 2 seasons — too few to read separately",
            "relaxed": "international",
            "players": 8,
            "seasonsObserved": 3
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "MEDIUM",
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
            "verdictKey": "policy-shift-same-coach",
            "verdictNote": "the same coach, but the recent seasons look different from the early ones — weight the recent ones",
            "seasonsObserved": 4,
            "players": 33,
            "shareBySeason": [
              {
                "season": "2022",
                "shareOfSquadMinutes": 0.22248716067498167,
                "intake": 12,
                "measured": 12
              },
              {
                "season": "2023",
                "shareOfSquadMinutes": 0.11314919483843447,
                "intake": 7,
                "measured": 7
              },
              {
                "season": "2024",
                "shareOfSquadMinutes": 0.02789679139293535,
                "intake": 9,
                "measured": 9
              },
              {
                "season": "2025",
                "shareOfSquadMinutes": 0.036464646464646464,
                "intake": 5,
                "measured": 5
              }
            ],
            "minuteShares": {
              "n": 12,
              "freshman": 5.3,
              "newcomer": 23.5,
              "returning": 71.2
            },
            "spread": 7.812109141294179,
            "step": -13.563745882791718,
            "coach": "Kevin Hudson",
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
                "median": 894,
                "low": 373,
                "high": 1436,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 415,
                "low": 0,
                "high": 1151,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 3,
                "median": 129,
                "low": 0,
                "high": 880,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 4,
                "median": 68,
                "low": 0,
                "high": 181,
                "band": "fringe",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 5,
                "median": 0,
                "low": 0,
                "high": 24,
                "band": "none",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 6,
                "median": 0,
                "low": 0,
                "high": 12,
                "band": "none",
                "agreement": "tight",
                "seasonsWithThisMany": 3
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
              "n": 33,
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
            "programmeMedian": 894,
            "programmeSpread": {
              "low": 373,
              "high": 1436,
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
              "n": 33,
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
          "kind": "CONFERENCE_TITLE",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "conference": "ACC"
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
        }
      ],
      "PROGRAMME_CONTEXT": [
        {
          "kind": "COACH_CONTEXT",
          "decisionClass": "CONTEXT",
          "polarity": "NEUTRAL",
          "category": "coach",
          "facts": {
            "coach": "Kevin Hudson",
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
                "coach": "Kevin Hudson"
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
  "Ohio State": {
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
        "RECRUITMENT_PATHWAY": 5,
        "DEVELOPMENT": 3,
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
            "count": 2,
            "names": [
              "Christian Baumgartner",
              "Elijah Bishop"
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
              "players": 3,
              "projectedMinutes": 445,
              "beforeClassYear": 2027,
              "byYear": [
                {
                  "year": 2026,
                  "minutes": 0,
                  "players": 2
                },
                {
                  "year": 2027,
                  "minutes": 445,
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
          "kind": "HISTORICAL_SAME_COUNTRY",
          "decisionClass": "PATHWAY",
          "polarity": "POSITIVE",
          "category": "international",
          "facts": {
            "country": "New Zealand",
            "count": 1,
            "names": [
              "Xavier Green"
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
      },
      {
        "primary": {
          "kind": "PROGRAM_MOMENTUM",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "classification": "RISING",
            "recentWinPct": 0.64,
            "priorWinPct": 0.55
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
              "Christian Baumgartner",
              "Elijah Bishop"
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
            "players": 3,
            "projectedMinutes": 445,
            "beforeClassYear": 2027,
            "byYear": [
              {
                "year": 2026,
                "minutes": 0,
                "players": 2
              },
              {
                "year": 2027,
                "minutes": 445,
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
            "count": 7,
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
            "total": 3,
            "starters": 1,
            "names": [
              "Christian Baumgartner",
              "Elijah Bishop",
              "Marko Borkovic"
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
              "Xavier Green"
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
            "count": 9,
            "seasons": [
              "2023",
              "2024",
              "2025",
              "2026"
            ],
            "observedIntakes": 4,
            "intakesWithArrival": 4,
            "meanPerIntake": 2.25,
            "byIntake": {
              "2022->2023": 1,
              "2023->2024": 1,
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
              "n": 9,
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
            "count": 6,
            "countries": [
              "Canada",
              "Denmark",
              "France",
              "Norway",
              "United Kingdom"
            ],
            "uniqueCountries": 5
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
            "squadSize": 29,
            "share": 0.21
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
          "kind": "PROGRAMME_DEVELOPMENT_PATTERN",
          "decisionClass": "FIT",
          "polarity": "NEUTRAL",
          "category": "development",
          "facts": {
            "verdictKey": "steady",
            "verdictNote": "one coach, a consistent pattern — every season counts and the record is as firm as this gets",
            "seasonsObserved": 3,
            "players": 19,
            "shareBySeason": [
              {
                "season": "2022",
                "shareOfSquadMinutes": 0.12506914759869248,
                "intake": 8,
                "measured": 8
              },
              {
                "season": "2024",
                "shareOfSquadMinutes": 0.11518993114141092,
                "intake": 6,
                "measured": 6
              },
              {
                "season": "2025",
                "shareOfSquadMinutes": 0.12646370023419204,
                "intake": 5,
                "measured": 5
              }
            ],
            "minuteShares": {
              "n": 6,
              "freshman": 11,
              "newcomer": 7.3,
              "returning": 81.6
            },
            "spread": 0.5018206457162298,
            "step": 0.13945526354995685,
            "coach": "Brian Maisonneuve",
            "coachStillInPost": true
          },
          "qualification": {
            "tier": "SIGNAL",
            "temporality": "HISTORICAL",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": null,
            "season": "2022, 2024, 2025",
            "source": "roster_players:freshman-minutes",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2024",
                "2025"
              ],
              "seasonsUnread": [],
              "n": 3,
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
                "median": 978,
                "low": 819,
                "high": 1053,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 2,
                "median": 753,
                "low": 494,
                "high": 1040,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 3,
                "median": 417,
                "low": 397,
                "high": 514,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 4,
                "median": 197,
                "low": 16,
                "high": 288,
                "band": "fringe",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 5,
                "median": 0,
                "low": 0,
                "high": 45,
                "band": "none",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 6,
                "median": 0,
                "low": 0,
                "high": 0,
                "band": "none",
                "agreement": "tight",
                "seasonsWithThisMany": 2
              }
            ],
            "seasonsObserved": 3,
            "medianIntake": 6,
            "medianPlayed": 4,
            "seasonsWithAnImpactFreshman": 3
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "HIGH",
            "confidenceBeforeFreshness": null,
            "freshness": null,
            "season": "2022, 2024, 2025",
            "source": "roster_players:freshman-minutes",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2024",
                "2025"
              ],
              "seasonsUnread": [],
              "n": 19,
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
            "programmeMedian": 978,
            "programmeSpread": {
              "low": 819,
              "high": 1053,
              "agreement": "tight"
            },
            "pool": {
              "n": 770,
              "p25": 901,
              "median": 1118,
              "p75": 1289
            },
            "band": "p25-to-median"
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
                "2024",
                "2025"
              ],
              "seasonsUnread": [],
              "n": 19,
              "cohort": null
            },
            "comparison": {
              "basis": "mens-soccer programmes with a readable freshman ladder, 2022-2023-2024-2025",
              "statistic": "ladder-rank-1-median-minutes",
              "poolSize": 920,
              "percentile": null,
              "band": "p25-to-median"
            }
          }
        }
      ],
      "ACADEMIC_PROGRAMME_FIT": [
        {
          "kind": "PROGRAM_MOMENTUM",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "classification": "RISING",
            "recentWinPct": 0.64,
            "priorWinPct": 0.55
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
            "coach": "Brian Maisonneuve",
            "seasonsObserved": 2,
            "since": 2025,
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
            "season": "2025-2026",
            "source": "coach_seasons",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2023",
                "2025",
                "2026"
              ],
              "seasonsUnread": [
                "2024"
              ],
              "n": 2,
              "cohort": {
                "coach": "Brian Maisonneuve"
              }
            },
            "comparison": null
          }
        }
      ]
    }
  },
  "Rollins": {
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
        "RECRUITMENT_PATHWAY": 6,
        "DEVELOPMENT": 4,
        "ACADEMIC_PROGRAMME_FIT": 1,
        "PROGRAMME_CONTEXT": 1
      }
    },
    "topReasons": [
      {
        "primary": {
          "kind": "COACH_ARRIVAL_SAME_COUNTRY",
          "decisionClass": "PATHWAY",
          "polarity": "POSITIVE",
          "category": "international",
          "facts": {
            "country": "New Zealand",
            "coach": "Keith Buckley",
            "position": null,
            "count": 1,
            "seasons": [
              "2023"
            ],
            "namedArrival": "Liam Knight",
            "namedArrivalSeason": "2023",
            "attributableIntakes": 4,
            "intakesWithArrival": 1,
            "arrivals": [
              {
                "player": "Liam Knight",
                "season": "2023",
                "country": "New Zealand",
                "region": "OCEANIA",
                "position": "FORWARD",
                "coach": "Keith Buckley",
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
                "coach": "Keith Buckley",
                "position": null
              }
            },
            "comparison": null
          }
        },
        "supporting": [
          {
            "kind": "HISTORICAL_SAME_COUNTRY",
            "decisionClass": "PATHWAY",
            "polarity": "POSITIVE",
            "category": "international",
            "facts": {
              "country": "New Zealand",
              "count": 1,
              "names": [
                "Liam Knight"
              ],
              "seasonsPresent": [
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
              "season": "2023",
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
          "kind": "POSTSEASON_RESULT",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "round": "final"
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
            "count": 12,
            "squadSize": 34
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
            "starters": 2,
            "names": [
              "Max Walker",
              "Kilian Vallant",
              "Pedro Lameiras",
              "Noah Tatlonghari"
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
            "coach": "Keith Buckley",
            "position": null,
            "count": 1,
            "seasons": [
              "2023"
            ],
            "namedArrival": "Liam Knight",
            "namedArrivalSeason": "2023",
            "attributableIntakes": 4,
            "intakesWithArrival": 1,
            "arrivals": [
              {
                "player": "Liam Knight",
                "season": "2023",
                "country": "New Zealand",
                "region": "OCEANIA",
                "position": "FORWARD",
                "coach": "Keith Buckley",
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
                "coach": "Keith Buckley",
                "position": null
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
              "Liam Knight"
            ],
            "seasonsPresent": [
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
            "season": "2023",
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
              "2022->2023": 1,
              "2023->2024": 5,
              "2024->2025": 6,
              "2025->2026": 6
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
            "arrivals": 2,
            "atPosition": 1,
            "squadSize": 34
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
              "Austria",
              "Belgium",
              "Brazil",
              "Canada",
              "Colombia",
              "Germany",
              "Iceland",
              "Norway",
              "Spain",
              "United Kingdom",
              "Venezuela"
            ],
            "uniqueCountries": 11
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
            "squadSize": 34,
            "share": 0.47
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
                "median": 621,
                "low": 224,
                "high": 662,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 2,
                "median": 108,
                "low": 31,
                "high": 504,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 3,
                "median": 2,
                "low": 0,
                "high": 163,
                "band": "fringe",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 4,
                "median": 0,
                "low": 0,
                "high": 24,
                "band": "none",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 5,
                "median": 0,
                "low": 0,
                "high": 0,
                "band": "none",
                "agreement": "tight",
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
            "refused": "DEFENSE / international: only 5 in 2 seasons — too few to read separately",
            "relaxed": "international",
            "players": 18,
            "seasonsObserved": 3
          },
          "qualification": {
            "tier": "FACT",
            "temporality": "HISTORICAL",
            "confidence": "MEDIUM",
            "confidenceBeforeFreshness": null,
            "freshness": null,
            "season": "2022, 2024, 2025",
            "source": "roster_players:freshman-minutes",
            "sourceUrl": null,
            "window": {
              "seasons": [
                "2022",
                "2024",
                "2025"
              ],
              "seasonsUnread": null,
              "n": 18,
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
            "players": 38,
            "shareBySeason": [
              {
                "season": "2022",
                "shareOfSquadMinutes": 0.2106332014163716,
                "intake": 9,
                "measured": 9
              },
              {
                "season": "2023",
                "shareOfSquadMinutes": 0.057217629215488015,
                "intake": 5,
                "measured": 5
              },
              {
                "season": "2024",
                "shareOfSquadMinutes": 0.09923803718378543,
                "intake": 13,
                "measured": 13
              },
              {
                "season": "2025",
                "shareOfSquadMinutes": 0.14903846153846154,
                "intake": 11,
                "measured": 11
              }
            ],
            "minuteShares": {
              "n": 8,
              "freshman": 12.1,
              "newcomer": 33.7,
              "returning": 54.3
            },
            "spread": 5.723634913069248,
            "step": -0.9787165954806323,
            "coach": "Keith Buckley",
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
                "median": 1038,
                "low": 826,
                "high": 1328,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 487,
                "low": 105,
                "high": 982,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 3,
                "median": 373,
                "low": 31,
                "high": 662,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 4,
                "median": 306,
                "low": 0,
                "high": 618,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 5,
                "median": 182,
                "low": 0,
                "high": 465,
                "band": "fringe",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 6,
                "median": 31,
                "low": 2,
                "high": 163,
                "band": "fringe",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              }
            ],
            "seasonsObserved": 4,
            "medianIntake": 10,
            "medianPlayed": 6,
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
              "n": 38,
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
            "programmeMedian": 1038,
            "programmeSpread": {
              "low": 826,
              "high": 1328,
              "agreement": "tight"
            },
            "pool": {
              "n": 770,
              "p25": 901,
              "median": 1118,
              "p75": 1289
            },
            "band": "p25-to-median"
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
              "n": 38,
              "cohort": null
            },
            "comparison": {
              "basis": "mens-soccer programmes with a readable freshman ladder, 2022-2023-2024-2025",
              "statistic": "ladder-rank-1-median-minutes",
              "poolSize": 920,
              "percentile": null,
              "band": "p25-to-median"
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
            "round": "final"
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
            "coach": "Keith Buckley",
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
                "coach": "Keith Buckley"
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
  }
};
