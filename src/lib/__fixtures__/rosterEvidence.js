/**
 * Real ROSTER_OPPORTUNITY payloads for one athlete at six programmes.
 *
 * Chosen because between them they exercise every shape the section has to
 * handle: Jacksonville's graduation-plus-starters-plus-multi-year-cliff,
 * St. Thomas's scarcity beside returning depth, a programme whose only roster
 * evidence is the group size, one carrying squad-wide graduation, and one with
 * no roster evidence at all.
 */
export const ROSTER_FIXTURES = {
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
  "St. Thomas": {
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
        "ROSTER_OPPORTUNITY": 5,
        "RECRUITMENT_PATHWAY": 4,
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
              "Orin Mitchell"
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
          "kind": "POSITION_GROUP_SCARCITY",
          "decisionClass": "OPENING",
          "polarity": "POSITIVE",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
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
        },
        "supporting": [
          {
            "kind": "RETURNING_POSITION_DEPTH",
            "decisionClass": "OPENING",
            "polarity": "POSITIVE",
            "category": "roster",
            "facts": {
              "position": "DEFENSE",
              "returning": 2,
              "groupSize": 3,
              "beforeClassYear": 2027,
              "unknownEligibility": 0
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
        "dedupeGroup": "position-depth",
        "section": "ROSTER_OPPORTUNITY"
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
            "priorWinPct": 0.23
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
            "count": 1,
            "names": [
              "Orin Mitchell"
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
          "kind": "POSITION_GROUP_SCARCITY",
          "decisionClass": "OPENING",
          "polarity": "POSITIVE",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
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
        },
        {
          "kind": "RETURNING_POSITION_DEPTH",
          "decisionClass": "OPENING",
          "polarity": "POSITIVE",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "returning": 2,
            "groupSize": 3,
            "beforeClassYear": 2027,
            "unknownEligibility": 0
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
            "count": 3,
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
            "total": 8,
            "starters": 0,
            "names": [
              "Orin Mitchell",
              "Cian Williams",
              "Quentin Hauswald",
              "Enrique Herrera",
              "Sam Moore",
              "Ednilson Voiles",
              "Johann Joensen",
              "Damian Climent"
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
            "count": 10,
            "seasons": [
              "2023",
              "2024",
              "2025",
              "2026"
            ],
            "observedIntakes": 4,
            "intakesWithArrival": 4,
            "meanPerIntake": 2.5,
            "byIntake": {
              "2022->2023": 2,
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
              "n": 10,
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
            "count": 14,
            "countries": [
              "Estonia",
              "France",
              "Germany",
              "Haiti",
              "Ireland",
              "Italy",
              "Spain",
              "United Kingdom"
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
            "count": 14,
            "squadSize": 28,
            "share": 0.5
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
                "median": 153,
                "low": 75,
                "high": 517,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 2,
                "median": 23,
                "low": 0,
                "high": 45,
                "band": "fringe",
                "agreement": "tight",
                "seasonsWithThisMany": 2
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
                "shareOfSquadMinutes": 0.251252241667182,
                "intake": 12,
                "measured": 12
              },
              {
                "season": "2023",
                "shareOfSquadMinutes": 0.19670278534866714,
                "intake": 7,
                "measured": 7
              },
              {
                "season": "2024",
                "shareOfSquadMinutes": 0.1351008499302296,
                "intake": 7,
                "measured": 7
              },
              {
                "season": "2025",
                "shareOfSquadMinutes": 0.0860458196965189,
                "intake": 3,
                "measured": 3
              }
            ],
            "minuteShares": {
              "n": 9,
              "freshman": 8.9,
              "newcomer": 34.3,
              "returning": 56.7
            },
            "spread": 6.235288151585983,
            "step": -11.340417869455033,
            "coach": "Jon Lowery",
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
                "median": 1253,
                "low": 969,
                "high": 1293,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 701,
                "low": 153,
                "high": 1132,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 3,
                "median": 325,
                "low": 0,
                "high": 610,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 4,
                "median": 517,
                "low": 97,
                "high": 534,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 5,
                "median": 48,
                "low": 45,
                "high": 323,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 6,
                "median": 0,
                "low": 0,
                "high": 135,
                "band": "none",
                "agreement": "tight",
                "seasonsWithThisMany": 3
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
            "programmeMedian": 1253,
            "programmeSpread": {
              "low": 969,
              "high": 1293,
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
              "n": 29,
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
          "kind": "PROGRAM_MOMENTUM",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "classification": "RISING",
            "recentWinPct": 0.4,
            "priorWinPct": 0.23
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
            "coach": "Jon Lowery",
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
                "coach": "Jon Lowery"
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
  "Siena": {
    "programme": {
      "resolved": true
    },
    "summary": {
      "reasonCount": 2,
      "hasPositiveReasons": true,
      "openingIdentified": true,
      "hasEvidence": true,
      "evidenceCount": 14,
      "sectionCounts": {
        "ROSTER_OPPORTUNITY": 3,
        "RECRUITMENT_PATHWAY": 4,
        "DEVELOPMENT": 4,
        "ACADEMIC_PROGRAMME_FIT": 2,
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
            "count": 3,
            "squadSize": 27,
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
        },
        "supporting": [
          {
            "kind": "RETURNING_POSITION_DEPTH",
            "decisionClass": "OPENING",
            "polarity": "POSITIVE",
            "category": "roster",
            "facts": {
              "position": "DEFENSE",
              "returning": 3,
              "groupSize": 3,
              "beforeClassYear": 2027,
              "unknownEligibility": 0
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
        "dedupeGroup": "position-depth",
        "section": "ROSTER_OPPORTUNITY"
      },
      {
        "primary": {
          "kind": "CONFERENCE_TITLE",
          "decisionClass": "FIT",
          "polarity": "POSITIVE",
          "category": "performance",
          "facts": {
            "conference": "MAAC"
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
          "kind": "POSITION_GROUP_SCARCITY",
          "decisionClass": "OPENING",
          "polarity": "POSITIVE",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "count": 3,
            "squadSize": 27,
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
        },
        {
          "kind": "RETURNING_POSITION_DEPTH",
          "decisionClass": "OPENING",
          "polarity": "POSITIVE",
          "category": "roster",
          "facts": {
            "position": "DEFENSE",
            "returning": 3,
            "groupSize": 3,
            "beforeClassYear": 2027,
            "unknownEligibility": 0
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
            "count": 3,
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
            "count": 7,
            "seasons": [
              "2023",
              "2024",
              "2025",
              "2026"
            ],
            "observedIntakes": 4,
            "intakesWithArrival": 4,
            "meanPerIntake": 1.75,
            "byIntake": {
              "2022->2023": 1,
              "2023->2024": 2,
              "2024->2025": 2,
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
              "n": 7,
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
            "atPosition": 0,
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
            "count": 16,
            "countries": [
              "Belgium",
              "China",
              "France",
              "Germany",
              "Jamaica",
              "Norway",
              "Portugal",
              "Spain",
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
            "squadSize": 27,
            "share": 0.59
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
                "median": 1421,
                "low": 1092,
                "high": 1710,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 953,
                "low": 549,
                "high": 1530,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 3,
                "median": 764,
                "low": 0,
                "high": 1041,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 4,
                "median": 118,
                "low": 0,
                "high": 236,
                "band": "fringe",
                "agreement": "tight",
                "seasonsWithThisMany": 2
              },
              {
                "rank": 5,
                "median": 5,
                "low": 0,
                "high": 9,
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
            "refused": "DEFENSE / international: only 5 in 3 seasons — too few to read separately",
            "relaxed": "international",
            "players": 15,
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
              "n": 15,
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
            "players": 27,
            "shareBySeason": [
              {
                "season": "2022",
                "shareOfSquadMinutes": 0.08624586114468913,
                "intake": 4,
                "measured": 4
              },
              {
                "season": "2023",
                "shareOfSquadMinutes": 0.24795008912655972,
                "intake": 7,
                "measured": 7
              },
              {
                "season": "2024",
                "shareOfSquadMinutes": 0.25206495476765745,
                "intake": 7,
                "measured": 7
              },
              {
                "season": "2025",
                "shareOfSquadMinutes": 0.2497908824759515,
                "intake": 9,
                "measured": 9
              }
            ],
            "minuteShares": {
              "n": 9,
              "freshman": 28.3,
              "newcomer": 3.1,
              "returning": 68.5
            },
            "spread": 7.089459394216262,
            "step": 8.382994348618006,
            "coach": "Graciano Brito",
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
                "median": 1421,
                "low": 1092,
                "high": 1710,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 2,
                "median": 1206,
                "low": 549,
                "high": 1530,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 3,
                "median": 903,
                "low": 0,
                "high": 1178,
                "band": "impact",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 4,
                "median": 475,
                "low": 0,
                "high": 763,
                "band": "rotation",
                "agreement": "tight",
                "seasonsWithThisMany": 4
              },
              {
                "rank": 5,
                "median": 2,
                "low": 0,
                "high": 236,
                "band": "fringe",
                "agreement": "wide",
                "seasonsWithThisMany": 3
              },
              {
                "rank": 6,
                "median": 0,
                "low": 0,
                "high": 9,
                "band": "none",
                "agreement": "tight",
                "seasonsWithThisMany": 3
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
            "programmeMedian": 1421,
            "programmeSpread": {
              "low": 1092,
              "high": 1710,
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
              "n": 27,
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
            "conference": "MAAC"
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
            "coach": "Graciano Brito",
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
                "coach": "Graciano Brito"
              }
            },
            "comparison": null
          }
        }
      ]
    }
  }
};
