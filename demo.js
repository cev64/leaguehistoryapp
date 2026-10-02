/* The demo league: Sunday Scaries, a made-up ten-team dynasty league with
   five seasons behind it (2022 to 2025) and a sixth in progress (2026,
   through week 8), so a visitor can see every page of the site before
   connecting a league of their own. Open it at season.html?league=demo.

   Nothing here is real but the players' names (the site's own
   data/players.json supplies them, by Sleeper id). The managers, teams,
   scores, trades and drafts are simulated, the same way every visit, from
   a fixed seed.

   It answers in Sleeper's own words: sleeper.js asks for
   /league/demo/rosters, /league/demo-2024/matchups/7 and so on exactly as
   it would ask Sleeper, and this file hands back the same shapes Sleeper
   would. So every page, box score, player card, front-office table and
   the trophy room reads the demo through the same code as a real league.

   Loaded on demand by sleeper.js, only when a page opens the demo. */
(function () {
  "use strict";

  /* ------------------------------------------------------------ the league */

  const YEARS = [2022, 2023, 2024, 2025, 2026];
  const NOW = 2026;            // the season being played
  const THROUGH = 8;           // its last final week
  const REGULAR = 14;          // weeks of regular season
  const PLAYOFF_START = 15;
  const LAST_WEEK = 17;
  const TEAMS_N = 10;
  const SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "DEF"];
  const ROSTER = 15;           // nine starters and six on the bench
  const BUDGET = 100;          // FAAB a season
  // What a roster always holds, and never more than.
  const MINS = { QB: 1, RB: 3, WR: 3, TE: 1, DEF: 1 };
  const CAPS = { QB: 2, RB: 7, WR: 7, TE: 2, DEF: 1 };
  const TRADE_DEADLINE = 11;
  const KICKOFF = { 2022: "2022-09-08", 2023: "2023-09-07", 2024: "2024-09-05", 2025: "2025-09-04", 2026: "2026-09-10" };
  const SEED = 20294;

  const LEAGUE_NAME = "Sunday Scaries";
  const leagueId = (y) => (y === NOW ? "demo" : `demo-${y}`);
  const yearOf = (id) => (id === "demo" ? NOW : Number(String(id).slice(5)));

  /* The managers, each with a team name a season (some renamed theirs
     after a big rookie arrived), a colour for their logo, and how they run
     a team: how well they set a lineup, how often they work the waiver
     wire, and how keen they are to trade. */
  const MANAGERS = [
    { name: "GridironGreg", teams: { 2022: "Greg's Gridiron", 2023: "Bijan Mustard" }, color: "#e4572e", skill: 0.94, wire: 0.45, deals: 0.5 },
    { name: "WaiverWendy", teams: { 2022: "Kittle Big Planet" }, color: "#2e86de", skill: 0.86, wire: 0.75, deals: 0.3 },
    { name: "TDTommy", teams: { 2022: "Dak to the Future" }, color: "#10ac84", skill: 0.82, wire: 0.3, deals: 0.4 },
    { name: "FlexLuthor", teams: { 2022: "Lamb Chops" }, color: "#8e44ad", skill: 0.9, wire: 0.4, deals: 0.7 },
    { name: "PuntQueen", teams: { 2022: "Hurts So Good" }, color: "#f39c12", skill: 0.78, wire: 0.25, deals: 0.25 },
    { name: "DraftDayDana", teams: { 2022: "Dana's Draft Day", 2023: "Purdy Little Liars" }, color: "#c0392b", skill: 0.88, wire: 0.35, deals: 0.45 },
    { name: "SackMasterSam", teams: { 2022: "Chase Your Dreams" }, color: "#16a085", skill: 0.84, wire: 0.5, deals: 0.6 },
    { name: "HailMaryHank", teams: { 2022: "Hail Mary Full of Grace", 2023: "Gibbs Me a Break" }, color: "#2c3e50", skill: 0.8, wire: 0.55, deals: 0.8 },
    { name: "RedZoneRita", teams: { 2022: "Taco Corp" }, color: "#d35400", skill: 0.87, wire: 0.6, deals: 0.35 },
    { name: "BenchBoss", teams: { 2022: "London Calling" }, color: "#6c5ce7", skill: 0.72, wire: 0.2, deals: 0.3 },
  ];
  const userId = (i) => `9000000000000000${String(i + 1).padStart(2, "0")}`;
  const teamName = (i, y) => {
    const t = MANAGERS[i].teams;
    let name = t[2022];
    YEARS.forEach((yy) => { if (yy <= y && t[yy]) name = t[yy]; });
    return name;
  };

  /* The players each manager built around, kept off everyone else's
     board: startup picks in 2022 (the player, and the round he went in),
     rookies in 2023. */
  const STARTUP_ROUND = {
    0: ["6794", 1], 1: ["4217", 3], 2: ["3294", 4], 3: ["6786", 1], 4: ["6904", 2],
    5: ["8183", 14], 6: ["7564", 1], 8: ["1466", 1], 9: ["8112", 6],
  };
  const STARTUP_CORE = Object.fromEntries(Object.entries(STARTUP_ROUND).map(([i, [pid]]) => [i, pid]));
  const ROOKIE_CORE = { 2023: { 0: "9509", 7: "9221" } };

  /* Players: [Sleeper id, position, club, PPR points a game in 2022 ... 2026
     (0 = not in the league that year)]. Real players, made-up numbers. */
  const POOL = [["4984","QB","BUF",24.9,24.3,23.4,23.1,22.6],["4881","QB","BAL",21.7,22.1,25.3,20.0,21.0],["11564","QB","NE",0,0,17.4,20.1,23.2],["6770","QB","CIN",22.0,15.3,22.9,18.0,20.6],["11566","QB","WAS",0,0,22.6,18.2,21.4],["11560","QB","CHI",0,0,16.4,22.9,21.3],["6904","QB","PHI",25.6,23.1,21.0,20.4,19.8],["6797","QB","LAC",22.0,22.3,20.9,21.8,19.3],["3294","QB","DAL",16.6,21.4,14.9,19.6,18.1],["4046","QB","KC",25.3,20.8,18.2,19.9,19.1],["7523","QB","JAX",17.9,20.7,20.4,22.1,21.4],["12508","QB","NYG",0,0,0,16.5,22.2],["11563","QB","DEN",0,0,14.5,17.9,20.7],["8183","QB","SF",10.9,19.8,18.3,19.0,18.6],["3163","QB","DET",17.5,18.6,19.9,18.4,17.0],["421","QB","LAR",22.8,21.0,21.8,21.2,18.1],["6804","QB","GB",18.5,15.9,18.6,18.4,19.9],["4892","QB","TB",18.7,16.5,16.9,18.1,15.4],["5849","QB","MIN",16.8,15.6,15.4,15.1,18.0],["12545","QB","NO",0,0,0,13.1,15.5],["4943","QB","SEA",15.7,17.5,14.5,15.9,16.3],["9758","QB","HOU",0,14.0,15.9,17.0,14.8],["13269","QB","LV",0,0,0,0,14.9],["12522","QB","TEN",0,0,0,12.5,16.2],["8161","QB","MIA",13.1,12.4,13.3,13.5,13.5],["5870","QB","IND",13.9,14.3,13.2,12.3,13.7],["9228","QB","CAR",0,10.8,13.0,15.1,14.2],["138","QB","PIT",16.2,15.8,15.2,12.4,14.4],["96","QB","PIT",14.8,0,15.2,13.6,11.9],["3257","QB","ARI",11.1,12.7,11.0,11.0,11.5],["1373","QB","NYJ",11.5,12.0,11.2,11.0,10.9],["11565","QB","NYG",0,0,8.5,10.4,10.2],["12524","QB","CLE",0,0,0,10.5,11.4],["11559","QB","ATL",0,0,8.0,9.4,10.3],["6768","QB","ATL",9.9,9.3,11.1,11.4,10.1],["13275","QB","LAR",0,0,0,0,9.8],["13310","QB","CHI",0,0,0,0,8.6],["1166","QB","LV",17.0,19.3,14.9,9.5,0],["13272","QB","ARI",0,0,0,0,8.4],["4017","QB","CLE",10.5,9.6,8.7,9.6,8.4],["12477","QB","SF",0,0,0,8.3,10.6],["6136","QB","DEN",10.3,9.9,9.0,9.2,8.7],["12705","QB","HOU",0,0,0,8.8,9.6],["13289","QB","PIT",0,0,0,0,10.1],["13303","QB","NYJ",0,0,0,0,9.1],["7527","QB","SF",8.3,10.2,10.6,10.3,10.2],["7591","QB","KC",9.6,10.0,8.9,9.5,9.2],["13597","QB","LAR",0,0,0,0,8.4],["9509","RB","ATL",0,15.6,19.9,22.4,21.8],["9221","RB","DET",0,16.4,20.6,21.6,21.0],["4034","RB","SF",22.0,24.5,9.8,20.2,17.1],["6813","RB","IND",12.8,13.0,16.0,20.1,18.0],["8138","RB","BUF",17.7,21.0,18.8,21.7,22.9],["3198","RB","BAL",18.6,15.2,19.8,18.0,15.6],["9226","RB","MIA",0,17.8,17.0,19.4,18.9],["4866","RB","PHI",17.9,15.1,21.5,16.2,15.3],["12507","RB","LAC",0,0,0,14.5,20.0],["12527","RB","LV",0,0,0,16.5,16.1],["8150","RB","LAR",3.2,19.0,16.9,16.4,15.2],["9224","RB","CIN",0,12.3,13.7,18.3,17.1],["13287","RB","ARI",0,0,0,0,16.0],["8151","RB","KC",14.0,14.3,16.8,16.6,14.4],["5850","RB","GB",19.4,12.6,17.4,16.8,15.1],["8155","RB","NYJ",16.8,14.9,14.1,13.0,13.8],["7588","RB","DAL",13.4,15.4,13.8,15.4,14.0],["11584","RB","TB",0,0,11.2,12.9,12.0],["7543","RB","NO",13.3,15.9,9.7,12.8,12.2],["12481","RB","NYG",0,0,0,11.1,13.5],["12529","RB","NE",0,0,0,11.0,11.9],["5892","RB","HOU",15.6,15.8,16.6,12.4,12.2],["12490","RB","JAX",0,0,0,9.6,11.1],["6790","RB","CHI",12.1,11.4,11.5,12.1,12.5],["12512","RB","CLE",0,0,0,9.5,11.3],["13286","RB","SEA",0,0,0,0,10.7],["8228","RB","PIT",8.6,10.3,10.3,10.5,10.4],["12489","RB","DEN",0,0,0,9.8,10.6],["7611","RB","NE",11.5,12.4,10.6,11.4,10.9],["12534","RB","CHI",0,0,0,9.1,8.8],["5967","RB","TEN",11.0,11.9,10.9,10.0,8.4],["7021","RB","PIT",10.8,11.1,11.4,9.5,9.6],["7594","RB","CAR",8.7,8.1,9.7,9.9,8.3],["11586","RB","LAR",0,0,7.9,8.0,8.7],["6806","RB","DEN",9.5,9.1,7.8,8.3,8.5],["8154","RB","ATL",6.5,7.2,7.9,8.7,7.3],["4199","RB","MIN",15.2,12.1,14.2,11.0,9.5],["7567","RB","TB",7.4,7.1,8.8,8.4,8.8],["11583","RB","CAR",0,0,5.7,6.8,6.9],["8132","RB","ARI",6.6,6.7,6.9,7.4,8.3],["4137","RB","ARI",13.2,10.2,8.7,9.2,7.5],["8408","RB","MIN",6.2,6.1,6.4,7.5,7.1],["12533","RB","WAS",0,0,0,5.5,7.8],["11581","RB","GB",0,0,5.9,7.0,6.2],["9753","RB","SEA",0,6.0,5.7,7.4,6.7],["12474","RB","HOU",0,0,0,5.6,6.7],["11655","RB","NYG",0,0,5.9,5.8,5.9],["13337","RB","KC",0,0,0,0,6.4],["11589","RB","ARI",0,0,4.8,5.3,5.8],["13345","RB","DEN",0,0,0,0,5.5],["4035","RB","NO",14.8,16.0,17.1,12.9,10.4],["9508","RB","TEN",0,4.9,5.2,5.7,5.3],["13305","RB","LV",0,0,0,0,5.5],["8136","RB","WAS",4.2,5.7,5.8,5.3,5.7],["10219","RB","JAX",0,5.1,4.8,6.1,5.6],["12469","RB","CLE",0,0,0,4.9,6.0],["11576","RB","NYJ",0,0,4.4,5.2,5.7],["11647","RB","LAC",0,0,4.9,4.9,5.8],["9225","RB","PHI",0,4.6,5.2,5.2,5.1],["9511","RB","LAC",0,3.8,4.5,4.7,5.6],["8205","RB","DET",4.0,4.5,4.7,5.6,5.6],["9506","RB","TB",0,4.4,4.6,4.8,4.9],["13405","RB","WAS",0,0,0,0,5.0],["13414","RB","SF",0,0,0,0,4.6],["11435","RB","SEA",0,4.0,4.4,5.5,5.5],["13288","RB","TEN",0,0,0,0,4.9],["11575","RB","BUF",0,0,3.7,5.0,4.6],["12476","RB","MIN",0,0,0,4.0,4.2],["7528","RB","NYG",4.9,5.3,5.4,5.0,4.7],["12504","RB","GB",0,0,0,3.6,4.4],["11643","RB","MIA",0,0,3.4,4.2,4.1],["13347","RB","MIN",0,0,0,0,4.0],["9757","RB","NO",0,3.5,4.0,4.6,4.6],["12455","RB","KC",0,0,0,4.1,4.6],["12457","RB","PHI",0,0,0,4.1,4.8],["11579","RB","MIN",0,0,3.5,4.0,4.9],["11569","RB","MIA",0,0,0,3.5,4.6],["12467","RB","SF",0,0,0,3.9,3.9],["5995","RB","BAL",5.3,5.3,5.0,5.2,4.6],["11273","RB","KC",0,3.2,4.0,4.3,4.6],["11186","RB","MIA",0,3.7,4.3,4.3,4.6],["12969","RB","NE",0,0,0,3.8,4.4],["3309","RB","WAS",3.9,3.7,3.8,4.0,3.8],["6992","RB","DET",0,0,3.7,4.0,4.3],["13964","RB","NE",0,0,0,0,4.2],["7103","RB","ARI",0,0,3.5,3.8,3.6],["13424","RB","IND",0,0,0,0,4.4],["13302","RB","BAL",0,0,0,0,4.3],["6012","RB","PIT",4.6,4.6,4.7,4.1,4.3],["12171","RB","HOU",0,0,3.1,3.4,3.8],["8800","RB","DAL",3.4,3.5,4.2,4.4,4.0],["11573","RB","BUF",0,0,3.2,3.7,4.1],["4147","RB","CIN",7.0,5.9,5.3,4.0,3.6],["11370","RB","GB",0,3.0,3.9,3.7,4.0],["12928","RB","LAC",0,0,0,3.0,3.5],["8423","RB","CHI",3.4,4.3,4.6,4.6,3.7],["12048","RB","SEA",0,0,3.2,3.6,3.8],["12495","RB","MIA",0,0,0,3.1,4.2],["13277","RB","NO",0,0,0,0,3.6],["8207","RB","DAL",3.5,4.0,3.4,3.8,4.1],["12491","RB","NE",0,0,0,3.7,3.8],["12356","RB","DET",0,0,2.9,3.3,4.2],["13423","RB","PIT",0,0,0,0,3.5],["13348","RB","JAX",0,0,0,0,3.9],["11199","RB","DAL",0,2.8,3.6,4.2,3.4],["12471","RB","IND",0,0,0,3.5,3.8],["12544","RB","JAX",0,0,0,3.6,3.9],["10223","RB","CLE",0,2.9,3.8,3.7,3.3],["11571","RB","NYJ",0,0,2.7,3.5,3.7],["11729","RB","DET",0,0,2.9,3.2,3.6],["6918","RB","CHI",3.5,4.0,3.3,3.9,4.0],["13418","RB","WAS",0,0,0,0,3.4],["6039","RB","BUF",5.3,5.0,5.2,4.0,3.6],["11280","RB","SEA",0,3.3,4.4,4.3,3.6],["13516","RB","MIN",0,0,0,0,3.6],["13010","RB","LAR",0,0,0,3.0,3.3],["7204","RB","NE",4.3,5.1,4.5,4.6,3.4],["13438","RB","NYJ",0,0,0,0,3.5],["13603","RB","LAC",0,0,0,0,3.7],["7087","RB","BAL",4.4,4.6,5.2,4.5,3.9],["12939","RB","CAR",0,0,0,3.3,4.0],["13419","RB","KC",0,0,0,0,4.0],["6175","RB","GB",0,3.0,3.6,3.2,3.8],["12656","RB","SEA",0,0,0,3.1,3.8],["2359","RB","JAX",6.2,5.0,4.2,4.5,3.3],["11384","RB","LV",0,2.9,3.3,3.4,3.8],["13595","RB","ATL",0,0,0,0,4.0],["12797","RB","CAR",0,0,0,3.0,3.7],["11574","RB","LV",0,0,2.8,3.4,3.5],["12897","RB","KC",0,0,0,2.9,3.3],["13437","RB","HOU",0,0,0,0,3.3],["14026","RB","MIA",0,0,0,0,3.9],["8181","RB","LV",2.9,3.1,3.9,4.0,3.5],["6323","RB","NYJ",4.8,4.9,4.2,3.9,3.2],["13436","RB","CIN",0,0,0,0,3.4],["8195","RB","LAR",2.8,3.4,3.9,3.8,3.5],["6659","RB","WAS",5.1,5.3,4.5,3.9,3.2],["11582","RB","PHI",0,0,2.8,3.7,3.2],["8116","RB","GB",2.9,3.5,3.9,3.3,3.4],["4663","RB","WAS",21.7,13.4,10.1,6.0,4.4],["8139","RB","NO",3.2,3.0,3.2,3.7,3.9],["3868","RB","LV",4.0,4.1,3.6,3.9,3.9],["13339","RB","IND",0,0,0,0,3.8],["4219","RB","WAS",5.7,5.8,4.3,3.7,3.3],["11588","RB","HOU",0,0,2.9,3.5,3.9],["11237","RB","DET",0,3.1,3.5,3.8,3.5],["12826","RB","NO",0,0,0,3.1,3.2],["8230","RB","NO",3.5,3.5,4.4,4.2,3.4],["7593","RB","ATL",3.0,3.3,3.7,3.7,3.2],["8254","RB","TEN",2.6,3.3,3.6,3.4,3.3],["7564","WR","CIN",19.0,17.2,23.4,21.0,20.2],["9493","WR","LAR",0,17.7,16.2,21.3,20.4],["9488","WR","SEA",0,17.0,23.0,23.1,21.0],["7547","WR","DET",17.5,20.1,18.9,18.4,17.6],["6786","WR","DAL",18.4,23.7,18.2,17.6,17.9],["6794","WR","MIN",22.5,21.0,19.8,20.6,19.4],["5859","WR","NE",17.8,17.9,16.3,15.0,13.9],["8112","WR","ATL",11.2,10.6,15.2,17.9,17.4],["7569","WR","HOU",9.0,15.9,17.4,16.5,15.9],["8137","WR","DAL",16.6,15.7,17.8,17.0,20.3],["11632","WR","NYG",0,0,17.6,15.9,18.2],["10229","WR","KC",0,13.8,17.8,18.9,18.3],["8144","WR","NO",12.9,13.6,10.2,12.8,13.6],["7525","WR","PHI",16.4,14.6,17.1,16.0,15.9],["11635","WR","LAC",0,0,12.6,13.9,14.1],["6801","WR","CIN",14.8,15.1,17.3,14.2,17.4],["8146","WR","NYJ",13.6,12.4,14.6,15.0,15.8],["12526","WR","CAR",0,0,0,11.6,14.8],["12514","WR","TB",0,0,0,12.3,16.0],["12519","WR","CHI",0,0,0,11.4,13.7],["9997","WR","BAL",0,12.4,11.5,13.5,14.8],["7526","WR","DEN",13.5,12.0,12.0,12.1,14.8],["2133","WR","LAR",19.2,16.4,15.1,14.8,12.0],["4983","WR","BUF",14.3,13.2,12.1,13.5,12.3],["8148","WR","DET",9.7,10.4,13.3,13.8,13.0],["5927","WR","WAS",16.0,12.8,13.6,13.3,13.6],["2216","WR","SF",14.7,17.1,16.0,10.3,10.9],["13279","WR","TEN",0,0,0,0,12.9],["13281","WR","NO",0,0,0,0,10.6],["11620","WR","CHI",0,0,9.9,11.1,12.1],["8167","WR","GB",9.6,10.6,10.5,10.5,10.6],["9487","WR","JAX",0,9.4,9.1,10.0,11.4],["5045","WR","DEN",10.7,10.2,10.1,11.6,10.1],["11628","WR","ARI",0,0,9.4,10.6,11.5],["5846","WR","PIT",9.5,9.1,9.1,10.1,10.6],["11631","WR","JAX",0,0,8.0,8.7,9.7],["10232","WR","ARI",0,8.2,9.5,10.2,10.5],["5947","WR","JAX",9.9,8.6,10.3,9.0,9.6],["4037","WR","TB",9.8,10.7,9.4,9.5,8.7],["13294","WR","PHI",0,0,0,0,8.4],["8142","WR","IND",8.0,8.6,8.6,8.7,10.0],["10222","WR","GB",0,7.2,7.7,9.4,9.1],["9756","WR","MIN",0,7.9,7.3,8.6,9.3],["9754","WR","LAC",0,7.5,8.7,7.5,8.0],["2449","WR","WAS",18.8,15.5,13.6,11.0,9.6],["8126","WR","TEN",6.5,8.3,8.1,7.7,8.7],["6819","WR","PIT",8.9,7.3,8.2,8.2,7.5],["13417","WR","SF",0,0,0,0,7.6],["9500","WR","IND",0,5.8,6.8,7.3,7.9],["13298","WR","CLE",0,0,0,0,7.9],["8121","WR","NE",5.7,6.2,7.2,7.8,6.9],["12501","WR","GB",0,0,0,6.1,6.8],["8134","WR","BUF",6.4,6.9,6.5,6.6,7.1],["11624","WR","KC",0,0,5.9,6.9,6.4],["7049","WR","MIN",6.5,7.4,6.9,6.7,6.7],["12484","WR","HOU",0,0,0,6.7,6.6],["5872","WR","SF",7.5,7.2,7.3,8.1,7.6],["11646","WR","CAR",0,0,5.3,5.9,7.1],["13293","WR","BAL",0,0,0,0,6.2],["8676","WR","SEA",4.7,6.7,6.4,7.0,6.4],["13276","WR","NYJ",0,0,0,0,7.0],["13346","WR","CLE",0,0,0,0,6.3],["13301","WR","WAS",0,0,0,0,5.8],["6783","WR","CLE",5.5,6.3,6.4,6.8,5.6],["11625","WR","NYJ",0,0,5.2,5.6,6.1],["9504","WR","HOU",0,4.5,5.4,6.1,6.7],["11618","WR","TB",0,0,4.4,5.6,6.4],["8180","WR","LV",5.4,5.1,5.4,6.5,6.6],["11627","WR","DEN",0,0,4.8,4.9,6.4],["12492","WR","DEN",0,0,0,4.9,6.3],["12540","WR","TEN",0,0,0,5.1,6.1],["11610","WR","MIA",0,0,4.2,5.7,5.3],["13413","WR","KC",0,0,0,0,5.4],["6803","WR","SF",6.0,5.9,5.1,5.1,5.4],["12509","WR","LAC",0,0,0,4.8,5.3],["4981","WR","TEN",5.8,6.0,6.7,6.4,4.8],["1479","WR","IND",14.4,19.3,13.5,12.1,8.9],["12535","WR","DET",0,0,0,4.7,5.4],["12499","WR","TEN",0,0,0,4.7,5.0],["13320","WR","ATL",0,0,0,0,5.1],["10213","WR","LV",0,4.3,4.8,5.4,5.1],["9502","WR","HOU",0,4.1,4.3,5.3,5.1],["12536","WR","HOU",0,0,0,4.1,5.4],["9494","WR","DEN",0,4.4,4.7,4.6,5.0],["7090","WR","NYG",4.5,4.5,4.9,4.5,4.9],["13274","WR","PIT",0,0,0,0,5.0],["12547","WR","NE",0,0,0,3.8,5.1],["13317","WR","TB",0,0,0,0,4.4],["4039","WR","SEA",21.5,14.8,14.0,9.5,7.4],["13311","WR","MIA",0,0,0,0,4.7],["13296","WR","MIA",0,0,0,0,5.3],["12497","WR","SEA",0,0,0,3.8,5.1],["11783","WR","DAL",0,0,4.3,4.7,5.1],["13268","WR","BAL",0,0,0,0,4.3],["7571","WR","BAL",4.9,4.6,5.2,5.1,4.3],["13285","WR","NYG",0,0,0,0,4.9],["11637","WR","BUF",0,0,4.2,3.9,4.4],["9486","WR","PHI",0,4.0,3.9,5.0,4.3],["12483","WR","LV",0,0,0,4.3,4.2],["11834","WR","NO",0,0,3.7,4.7,4.2],["4950","WR","SF",4.2,4.5,4.3,4.0,4.2],["7039","WR","LV",4.1,4.9,4.7,4.9,4.1],["11617","WR","CLE",0,0,3.9,3.8,4.5],["11638","WR","SF",0,0,3.8,4.0,4.8],["12829","WR","GB",0,0,0,3.9,4.5],["11474","WR","ATL",0,3.9,3.7,4.9,4.5],["3200","WR","NYJ",5.9,6.0,4.9,5.3,4.5],["12884","WR","GB",0,0,0,3.7,4.6],["13890","WR","MIN",0,0,0,0,4.3],["12475","WR","SEA",0,0,0,3.5,4.6],["13343","WR","ATL",0,0,0,0,3.8],["13411","WR","CHI",0,0,0,0,4.6],["13402","WR","BUF",0,0,0,0,4.0],["8253","WR","LV",3.6,4.5,4.3,4.4,4.1],["7066","WR","TEN",3.7,3.8,3.9,4.4,4.2],["13124","WR","NE",0,0,0,3.7,4.6],["13353","WR","CAR",0,0,0,0,3.8],["6154","WR","TB",4.3,4.7,4.0,4.0,4.0],["13760","WR","WAS",0,0,0,0,3.8],["6045","WR","LAC",4.0,3.9,4.3,4.3,3.9],["7812","WR","ARI",4.0,4.1,3.8,4.6,3.9],["6386","WR","LAR",4.1,4.1,4.7,4.9,4.4],["8250","WR","DET",3.3,3.7,3.6,4.3,4.2],["6798","WR","MIA",4.0,4.3,4.1,4.6,4.4],["8917","WR","DAL",3.4,4.6,4.0,4.5,4.0],["13208","WR","NO",0,0,0,3.4,3.7],["13533","WR","NO",0,0,0,0,4.4],["13011","WR","LAR",0,0,0,3.1,4.1],["13420","WR","NO",0,0,0,0,4.5],["12848","WR","HOU",0,0,0,3.2,3.8],["11895","WR","NO",0,0,3.4,3.8,4.2],["2334","WR","LV",6.1,4.8,4.6,4.2,3.6],["13380","WR","LAC",0,0,0,0,4.4],["11911","WR","MIN",0,0,3.5,4.0,3.6],["11320","WR","KC",0,3.6,4.0,4.0,4.3],["9501","WR","NE",0,3.3,3.5,3.6,3.8],["12788","WR","MIA",0,0,0,3.1,3.9],["12889","WR","ATL",0,0,0,3.7,4.2],["10226","WR","CIN",0,3.5,3.9,3.8,4.0],["13329","WR","LV",0,0,0,0,3.9],["12267","WR","CHI",0,0,3.5,3.8,3.8],["8119","WR","ATL",3.4,4.2,3.7,4.3,3.5],["8076","WR","DEN",3.5,3.7,4.2,4.4,4.2],["11377","WR","BUF",0,3.1,4.1,3.8,3.7],["8188","WR","KC",3.6,3.8,4.1,4.1,4.4],["13338","WR","MIA",0,0,0,0,3.9],["4992","WR","SF",4.6,4.5,4.7,4.2,4.2],["11626","WR","CAR",0,0,3.3,3.5,3.7],["11306","WR","PHI",0,3.3,3.3,4.3,3.6],["6960","WR","NYJ",3.5,3.6,4.3,3.8,3.6],["13862","WR","HOU",0,0,0,0,3.5],["6149","WR","IND",3.5,4.1,4.1,4.1,4.2],["11157","WR","CAR",0,2.9,3.8,3.8,4.2],["6866","WR","LAC",0,0,3.5,4.0,3.5],["8223","WR","SEA",3.5,4.0,4.3,3.5,3.6],["13270","WR","LAR",0,0,0,0,3.5],["8861","WR","SEA",2.8,4.0,4.2,4.0,4.2],["11168","WR","LAR",0,3.3,3.5,3.5,3.5],["5781","WR","SF",4.5,3.9,4.1,4.2,3.5],["13173","WR","KC",0,0,0,3.2,3.7],["13582","WR","DAL",0,0,0,0,4.1],["12542","WR","NE",0,0,0,3.3,3.7],["4351","WR","NYJ",5.5,5.0,5.0,4.3,3.5],["11762","WR","IND",0,0,3.1,3.6,4.1],["13392","WR","KC",0,0,0,0,3.7],["12460","WR","ATL",0,0,0,3.6,3.9],["12865","WR","MIA",0,0,0,3.2,4.2],["13830","WR","NE",0,0,0,0,3.5],["13825","WR","NYJ",0,0,0,0,4.2],["7559","WR","CAR",3.3,3.4,3.6,4.1,4.3],["11034","WR","ARI",0,2.8,3.6,3.9,4.1],["5970","WR","BUF",3.6,3.9,3.7,4.2,3.6],["13905","WR","KC",0,0,0,0,4.3],["10867","WR","SEA",0,3.0,3.4,4.0,3.9],["12756","WR","BUF",0,0,0,3.1,4.0],["12732","WR","DET",0,0,0,3.0,4.1],["6453","WR","IND",4.0,4.1,4.0,3.7,3.8],["12888","WR","NYG",0,0,0,3.3,4.2],["8414","WR","PHI",2.8,4.0,3.4,3.6,3.6],["12925","WR","NYJ",0,0,0,3.7,3.9],["13412","WR","DET",0,0,0,0,3.7],["5154","WR","BUF",4.6,3.9,4.1,4.2,4.1],["13770","WR","GB",0,0,0,0,4.1],["12908","WR","NE",0,0,0,3.5,3.7],["13726","WR","DAL",0,0,0,0,3.7],["8130","TE","ARI",3.8,10.6,13.1,15.6,14.8],["11604","TE","LV",0,0,13.9,13.2,14.4],["12517","TE","CHI",0,0,0,11.1,13.9],["12518","TE","IND",0,0,0,12.3,12.1],["10859","TE","DET",0,13.2,10.1,10.4,10.9],["12506","TE","CLE",0,0,0,8.8,10.0],["9484","TE","GB",0,7.8,9.1,10.2,9.3],["7553","TE","ATL",8.5,8.7,10.5,9.9,8.5],["4217","TE","SF",11.9,12.3,13.6,11.4,10.6],["10236","TE","BUF",0,7.1,7.6,7.6,8.4],["12493","TE","LAC",0,0,0,6.0,7.1],["1466","TE","KC",18.3,14.9,10.7,10.2,9.0],["3214","TE","NE",7.3,7.5,7.2,6.6,6.9],["5022","TE","PHI",6.7,7.3,7.5,6.7,6.5],["5012","TE","BAL",12.4,13.5,11.0,8.6,7.9],["8110","TE","DAL",5.0,5.7,6.2,6.0,5.9],["5001","TE","HOU",5.4,5.2,5.7,5.0,5.4],["7002","TE","NO",5.6,5.5,5.4,4.9,5.1],["9480","TE","JAX",0,4.1,4.9,4.9,5.2],["8131","TE","NYG",4.4,4.2,5.0,5.2,4.7],["13330","TE","NYJ",0,0,0,0,4.7],["11603","TE","SEA",0,0,4.1,3.8,4.6],["5844","TE","MIN",4.0,4.7,4.8,4.4,4.0],["4033","TE","LAC",4.3,4.3,4.5,4.3,4.4],["6865","TE","LAR",4.5,4.2,4.0,4.6,3.9],["8210","TE","WAS",3.5,3.7,4.3,3.7,4.5],["12498","TE","NYJ",0,0,0,3.3,3.5],["13349","TE","PHI",0,0,0,0,3.7],["12487","TE","LAR",0,0,0,3.2,3.4],["11597","TE","NYG",0,0,3.0,3.4,3.9],["8111","TE","TB",2.9,3.3,3.4,3.9,4.1],["12502","TE","TEN",0,0,0,3.2,3.4],["8698","TE","SF",3.2,3.3,3.3,3.3,3.8],["13401","TE","DAL",0,0,0,0,3.8],["13278","TE","LAR",0,0,0,0,3.6],["2118","TE","PIT",3.5,3.5,3.2,3.9,3.4],["7600","TE","PIT",3.3,3.7,3.7,3.4,3.3],["8172","TE","MIA",2.8,2.9,3.7,3.3,3.7],["8500","TE","CLE",2.6,3.1,3.2,3.3,3.1],["8249","TE","DEN",2.4,3.3,3.2,3.2,3.2],["8219","TE","NYJ",2.7,3.1,3.5,3.5,3.2],["13431","TE","DET",0,0,0,0,3.7],["8107","TE","CHI",3.0,2.8,3.6,3.7,3.6],["5409","TE","CIN",3.3,3.8,3.7,3.1,2.9],["11508","TE","DAL",0,3.0,3.2,3.1,3.0],["2505","TE","CAR",4.0,3.8,4.1,3.4,3.0],["13151","TE","SEA",0,0,0,3.1,3.5],["13421","TE","NE",0,0,0,0,3.0],["13355","TE","DAL",0,0,0,0,3.6],["7535","TE","ARI",3.1,3.5,3.4,3.6,3.5],["13013","TE","GB",0,0,0,3.1,3.0],["12062","TE","MIN",0,0,2.8,3.1,3.4],["3321","WR","FA",21.1,23.5,13.0,9.8,8.4],["4988","RB","FA",16.9,10.5,8.0,7.1,0],["4029","RB","FA",14.6,6.5,0,0,0],["4018","RB","FA",15.9,15.4,16.3,0,0],["167","QB","FA",15.1,0,0,0,0]];
  const DEFENCES = ["ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
    "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS"];

  /* ------------------------------------------------------------ chance */

  // A small seeded generator, so the league comes out the same every time.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let rand = mulberry32(SEED);
  const between = (a, b) => a + (b - a) * rand();
  const int = (a, b) => Math.floor(between(a, b + 1));
  const chance = (p) => rand() < p;
  const pick = (list) => list[Math.floor(rand() * list.length)];
  function normal() {
    let u = 0, v = 0;
    while (!u) u = rand();
    while (!v) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const r2 = (n) => Math.round(n * 100) / 100;

  /* ------------------------------------------------------------ the players */

  const P = new Map();
  POOL.forEach(([id, pos, club, ...ppg]) => P.set(id, { id, pos, club, ppg }));
  DEFENCES.forEach((club) => P.set(club, { id: club, pos: "DEF", club, ppg: YEARS.map(() => 0) }));
  const yi = (y) => YEARS.indexOf(y);
  const ppgOf = (pid, y) => (P.get(pid) ? P.get(pid).ppg[yi(y)] || 0 : 0);
  const posOf = (pid) => P.get(pid).pos;

  /* ------------------------------------------------------------ simulating */

  function simulate() {
    rand = mulberry32(SEED);
    // Defences: a points-a-game figure each season.
    DEFENCES.forEach((club) => { P.get(club).ppg = YEARS.map(() => r2(between(4.6, 9.4))); });

    const api = new Map();
    const put = (path, value) => api.set(path, value);
    const rosters = MANAGERS.map(() => new Set());           // what each team holds now
    const pickOwner = new Map();                             // `${year}.${round}.${rid}` -> rid holding it
    const ownerOfPick = (y, r, rid) => pickOwner.get(`${y}.${r}.${rid}`) || rid;
    const tradedPicks = [];                                  // every pick that changed hands
    let txnSeq = 1;
    let prevFinal = null;                                    // last season's final places (rid -> place)

    // A manager's sense of a player: this season's form plus where he's
    // heading, through their own imperfect eyes.
    const seen = new Map();
    function value(pid, y, rid) {
      const key = `${pid}.${y}.${rid}`;
      if (!seen.has(key)) {
        const now = ppgOf(pid, y);
        const later = [y + 1, y + 2].filter((x) => YEARS.includes(x)).map((x) => ppgOf(pid, x));
        const future = later.length ? later.reduce((a, b) => a + b, 0) / later.length : now * 0.9;
        const base = posOf(pid) === "DEF" ? now * 0.3 : now * 0.65 + future * 0.35;
        const scarce = { QB: 0.72, RB: 1.08, WR: 1, TE: 0.82, DEF: 1 }[posOf(pid)];
        seen.set(key, base * scarce * between(0.84, 1.16));
      }
      return seen.get(key);
    }
    const counts = (set) => {
      const c = { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0 };
      set.forEach((pid) => { c[posOf(pid)]++; });
      return c;
    };
    // Whether a team can let a player go and still fill its lineup.
    const canLose = (i, pid) => counts(rosters[i])[posOf(pid)] - 1 >= MINS[posOf(pid)];
    const needOf = (i) => {
      const c = counts(rosters[i]);
      return ["RB", "WR", "QB", "TE", "DEF"].find((pos) => c[pos] < MINS[pos]) || null;
    };
    const anchored = new Set([...Object.values(STARTUP_CORE), ...Object.values(ROOKIE_CORE[2023])]);
    const stamp = (y, w, extraHours = 0) => {
      const start = Date.parse(`${KICKOFF[y]}T12:00:00Z`);
      return start + (w - 1) * 7 * 864e5 - 864e5 + extraHours * 36e5 + int(0, 3599) * 1000;
    };

    for (const y of YEARS) {
      const lid = leagueId(y);
      const rid = (i) => i + 1;
      const transactions = {};
      const addTxn = (w, t) => {
        (transactions[w] = transactions[w] || []).push({
          status: "complete", status_updated: t.created, settings: null, metadata: null, leg: w,
          draft_picks: [], waiver_budget: [], drops: null, adds: null, consenter_ids: t.roster_ids,
          creator: userId(t.roster_ids[0] - 1), transaction_id: String(800000000000000000 + txnSeq++),
          ...t,
        });
      };
      const budgetUsed = MANAGERS.map(() => 0);
      const moves = MANAGERS.map(() => 0);
      const drafts = [];

      /* ---- the offseason: the draft, then cuts to fifteen ---- */
      const inLeague = (pid) => P.get(pid).pos === "DEF" || ppgOf(pid, y) > 0;
      const free = () => [...P.keys()].filter((pid) => inLeague(pid) && !rosters.some((r) => r.has(pid)));

      if (y === 2022) {
        // The startup: a fifteen-round snake from a random order.
        const order = shuffle(MANAGERS.map((_, i) => i));
        const picks = [];
        let no = 1;
        for (let round = 1; round <= ROSTER; round++) {
          const seq = round % 2 ? order : order.slice().reverse();
          for (const i of seq) {
            const mine = rosters[i];
            const c = counts(mine);
            const core = STARTUP_CORE[i];
            let choice = core && !mine.has(core) && round >= STARTUP_ROUND[i][1] ? core : null;
            if (!choice) {
              const short = ["QB", "RB", "WR", "TE"].filter((pos) => c[pos] < MINS[pos]);
              const left = ROSTER - round;  // picks after this one, the defence among them
              const need = round === ROSTER ? ["DEF"]
                : short.reduce((n, pos) => n + MINS[pos] - c[pos], 0) >= left ? short : [];
              const ok = (pid) => {
                const pos = posOf(pid);
                if (anchored.has(pid)) return false;
                if (need.length) return need.includes(pos);
                if (pos === "DEF") return round >= ROSTER - 1 && !c.DEF;
                if (pos === "QB") return c.QB < 2 && (c.QB < 1 || round > 8);
                if (pos === "TE") return c.TE < 2 && (c.TE < 1 || round > 9);
                return (pos === "RB" ? c.RB : c.WR) < 6;
              };
              const board = free().filter(ok).sort((a, b) => value(b, y, rid(i)) - value(a, y, rid(i)));
              choice = board[0];
            }
            mine.add(choice);
            const slot = order.indexOf(i) + 1;
            picks.push({ round, pick_no: no++, draft_slot: slot, roster_id: rid(i), player_id: choice, picked_by: userId(i) });
          }
        }
        drafts.push({ id: "demo-draft-2022", type: "snake", rounds: ROSTER, order, picks, start: stamp(y, 1, -24 * 12) });
      } else {
        // A rookie draft: three rounds, worst finish picks first; picks go
        // to whoever holds them now.
        const order = MANAGERS.map((_, i) => i).sort((a, b) => prevFinal[rid(b)] - prevFinal[rid(a)]);
        const rookies = () => free().filter((pid) => P.get(pid).pos !== "DEF" && ppgOf(pid, y) > 0 &&
          YEARS.filter((x) => x < y).every((x) => ppgOf(pid, x) === 0));
        // 2023: GridironGreg buys the first pick (for Bijan Robinson) with
        // his own first and a starter.
        if (y === 2023 && order[0] !== 0 && ownerOfPick(y, 1, rid(order[0])) === rid(order[0])) {
          const seller = order[0];
          const sweetener = [...rosters[0]].filter((pid) => !anchored.has(pid) && posOf(pid) !== "DEF" && posOf(pid) !== "QB")
            .sort((a, b) => value(b, y, 1) - value(a, y, 1))[1];
          pickOwner.set(`${y}.1.${rid(seller)}`, 1);
          pickOwner.set(`${y}.1.1`, rid(seller));
          const picks = [
            { season: String(y), round: 1, roster_id: rid(seller), previous_owner_id: rid(seller), owner_id: 1 },
            { season: String(y), round: 1, roster_id: 1, previous_owner_id: 1, owner_id: rid(seller) },
          ];
          tradedPicks.push(...picks);
          rosters[0].delete(sweetener);
          rosters[seller].add(sweetener);
          addTxn(1, {
            type: "trade", roster_ids: [1, rid(seller)], adds: { [sweetener]: rid(seller) }, drops: { [sweetener]: 1 },
            draft_picks: picks, created: stamp(y, 1, -24 * 12),
          });
        }
        const picks = [];
        let no = 1;
        for (let round = 1; round <= 3; round++) {
          order.forEach((orig, k) => {
            const holder = ownerOfPick(y, round, rid(orig)) - 1;
            const core = (ROOKIE_CORE[y] || {})[holder];
            const board = rookies().filter((pid) => !anchored.has(pid) || pid === core)
              .sort((a, b) => value(b, y, rid(holder)) - value(a, y, rid(holder)));
            const choice = core && !rosters[holder].has(core) ? core : board[0];
            if (!choice) return;
            rosters[holder].add(choice);
            picks.push({ round, pick_no: no++, draft_slot: k + 1, roster_id: rid(holder), player_id: choice, picked_by: userId(holder) });
          });
        }
        drafts.push({ id: `demo-draft-${y}`, type: "linear", rounds: 3, order, picks, start: stamp(y, 1, -24 * 10) });
        // Down to fifteen: the retired first, then whoever is worth least.
        // A team keeps one defence.
        MANAGERS.forEach((_, i) => {
          const mine = rosters[i];
          const drops = {};
          const cut = () => {
            const c = counts(mine);
            const list = [...mine].filter((pid) => !anchored.has(pid) && (c[posOf(pid)] - 1 >= MINS[posOf(pid)] || c[posOf(pid)] > CAPS[posOf(pid)]))
              .sort((a, b) => (inLeague(a) ? value(a, y, rid(i)) : -1) - (inLeague(b) ? value(b, y, rid(i)) : -1));
            return list[0];
          };
          [...mine].filter((pid) => !inLeague(pid)).forEach((pid) => { mine.delete(pid); drops[pid] = rid(i); });
          while (mine.size > ROSTER) { const pid = cut(); mine.delete(pid); drops[pid] = rid(i); }
          if (Object.keys(drops).length) {
            addTxn(1, { type: "free_agent", roster_ids: [rid(i)], drops, created: stamp(y, 1, -24 * 9) });
          }
        });
        // and back up to fifteen from free agency where retirements left holes
        MANAGERS.forEach((_, i) => {
          const mine = rosters[i];
          while (mine.size < ROSTER) {
            const c = counts(mine);
            const want = needOf(i);
            const best = free().filter((pid) => (want ? posOf(pid) === want : c[posOf(pid)] < CAPS[posOf(pid)])).sort((a, b) => value(b, y, rid(i)) - value(a, y, rid(i)))[0];
            mine.add(best);
            addTxn(1, { type: "free_agent", roster_ids: [rid(i)], adds: { [best]: rid(i) }, created: stamp(y, 1, -24 * 8) });
          }
        });
      }

      /* ---- the season's weeks ---- */
      const lastPlayed = y === NOW ? THROUGH : LAST_WEEK;
      // Byes and injuries for the year.
      // Byes as the NFL spreads them: two to four clubs a week, weeks 5 to 14.
      const bye = {};
      const byeWeeks = [5, 5, 6, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 12, 12, 12, 12, 13, 13, 14, 14];
      shuffle(DEFENCES).forEach((club, k) => { bye[club] = byeWeeks[k]; });
      bye.FA = 0;
      const hurt = new Map();
      P.forEach((p) => {
        if (p.pos !== "DEF" && chance(0.17)) {
          const from = int(1, 16), len = int(1, chance(0.25) ? 9 : 4);
          hurt.set(p.id, [from, from + len - 1]);
        }
      });
      const out = (pid, w) => {
        const p = P.get(pid);
        if (bye[p.club] === w) return "bye";
        const h = hurt.get(pid);
        return h && w >= h[0] && w <= h[1] ? "hurt" : null;
      };
      const points = new Map(); // `${pid}.${w}` -> points
      const scoreOf = (pid, w) => {
        const key = `${pid}.${w}`;
        if (!points.has(key)) {
          const p = P.get(pid);
          let pts = 0;
          if (!out(pid, w) && inLeague(pid)) {
            if (p.pos === "DEF") pts = Math.max(-4, ppgOf(pid, y) + normal() * 4.2);
            else {
              pts = ppgOf(pid, y) * Math.exp(normal() * 0.47) * 0.9;
              if (chance(0.05)) pts *= 0.2;
              if (chance(0.025)) pts *= 1.7;
            }
          }
          points.set(key, r2(pts));
        }
        return points.get(key);
      };
      // Form so far: what a manager goes on when choosing who to start.
      const form = (pid, w) => {
        const prior = ppgOf(pid, y) || 4;
        const weeks = [];
        for (let x = Math.max(1, w - 3); x < w; x++) if (!out(pid, x)) weeks.push(scoreOf(pid, x));
        const recent = weeks.length ? weeks.reduce((a, b) => a + b, 0) / weeks.length : prior;
        return prior * 0.65 + recent * 0.35;
      };

      // The schedule: everyone once (a round robin), then weeks 1 to 5 again.
      const ids = MANAGERS.map((_, i) => i);
      const rotation = shuffle(ids);
      const robin = [];
      for (let r = 0; r < TEAMS_N - 1; r++) {
        const pairs = [];
        for (let k = 0; k < TEAMS_N / 2; k++) pairs.push([rotation[k], rotation[TEAMS_N - 1 - k]]);
        robin.push(shuffle(pairs));
        rotation.splice(1, 0, rotation.pop());
      }
      const schedule = {};
      for (let w = 1; w <= REGULAR; w++) schedule[w] = w <= TEAMS_N - 1 ? robin[w - 1] : robin[w - TEAMS_N];

      const matchups = {};
      const record = MANAGERS.map(() => ({ wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, ppts: 0, log: "" }));
      const lineups = MANAGERS.map(() => []);

      // Choosing a lineup: best expected points into each slot, with the
      // manager now and then missing a bye or an injury.
      function setLineup(i, w) {
        const m = MANAGERS[i];
        const exp = new Map([...rosters[i]].map((pid) => {
          let e = form(pid, w) * between(0.9, 1.1);
          if (out(pid, w) && chance(m.skill + 0.04)) e = -1;
          if (!inLeague(pid)) e = -1;
          if (chance(1 - m.skill) && chance(0.35)) e *= between(0.5, 0.9);
          return [pid, e];
        }));
        const used = new Set();
        const starters = SLOTS.map((slot) => {
          const okPos = slot === "FLEX" ? ["RB", "WR", "TE"] : [slot];
          const best = [...rosters[i]].filter((pid) => !used.has(pid) && okPos.includes(posOf(pid)))
            .sort((a, b) => exp.get(b) - exp.get(a))[0];
          if (best) used.add(best);
          return best || "0";
        });
        return starters;
      }
      // The best lineup a team could have set, for its potential points.
      function bestPoints(i, w) {
        const used = new Set();
        let total = 0;
        ["QB", "RB", "RB", "WR", "WR", "TE", "DEF", "FLEX", "FLEX"].forEach((slot) => {
          const okPos = slot === "FLEX" ? ["RB", "WR", "TE"] : [slot];
          const best = [...rosters[i]].filter((pid) => !used.has(pid) && okPos.includes(posOf(pid)))
            .sort((a, b) => scoreOf(b, w) - scoreOf(a, w))[0];
          if (best) { used.add(best); total += scoreOf(best, w); }
        });
        return total;
      }

      /* Waivers before a week: claims in FAAB, the highest bid wins, the
         rest fail. */
      function waivers(w) {
        const claims = [];
        MANAGERS.forEach((m, i) => {
          // A hole in the lineup is always filled; otherwise it's how keen
          // the manager is.
          const need = needOf(i);
          if (!need && !chance(m.wire * (w <= 4 ? 1.2 : 0.8))) return;
          const mine = [...rosters[i]];
          const c = counts(rosters[i]);
          const dropList = mine.filter((pid) => !anchored.has(pid) && posOf(pid) !== "DEF" && posOf(pid) !== need && canLose(i, pid))
            .sort((a, b) => (inLeague(a) ? form(a, w) : -1) - (inLeague(b) ? form(b, w) : -1));
          const worst = dropList[0];
          if (!worst) return;
          const options = free().filter((pid) => posOf(pid) !== "DEF" && (need ? posOf(pid) === need : c[posOf(pid)] < CAPS[posOf(pid)] || posOf(pid) === posOf(worst)))
            .map((pid) => [pid, form(pid, w) * between(0.85, 1.25)])
            .sort((a, b) => b[1] - a[1]).slice(0, 4);
          const pickOne = need ? options[0] : options[int(0, Math.min(2, options.length - 1))];
          if (!pickOne) return;
          const [pid, want] = pickOne;
          const gap = want - (inLeague(worst) ? form(worst, w) : 0);
          if (!need && gap < 1.2) return;
          const left = BUDGET - budgetUsed[i];
          const bid = Math.max(0, Math.min(left, Math.round(Math.max(gap, 1.5) * between(1.2, 4.2) * (w <= 3 ? 1.6 : 1))));
          claims.push({ i, pid, bid, drop: worst, order: rand() });
        });
        const byPlayer = new Map();
        claims.forEach((c) => { if (!byPlayer.has(c.pid)) byPlayer.set(c.pid, []); byPlayer.get(c.pid).push(c); });
        byPlayer.forEach((list, pid) => {
          list.sort((a, b) => b.bid - a.bid || a.order - b.order);
          list.forEach((c, k) => {
            const r = rid(c.i);
            const base = { type: "waiver", roster_ids: [r], adds: { [pid]: r }, drops: { [c.drop]: r }, settings: { waiver_bid: c.bid, seq: k }, created: stamp(y, w, 2) };
            if (k === 0 && rosters[c.i].has(c.drop)) {
              rosters[c.i].delete(c.drop);
              rosters[c.i].add(pid);
              budgetUsed[c.i] += c.bid;
              moves[c.i]++;
              addTxn(w, base);
            } else {
              addTxn(w, { ...base, status: "failed" });
            }
          });
        });
        // A defence streamed now and then, as a free-agent pickup.
        MANAGERS.forEach((m, i) => {
          if (!chance(m.wire * 0.18)) return;
          const mine = [...rosters[i]].find((pid) => posOf(pid) === "DEF");
          const better = free().filter((pid) => posOf(pid) === "DEF").sort((a, b) => ppgOf(b, y) - ppgOf(a, y))[0];
          if (!mine || !better || ppgOf(better, y) <= ppgOf(mine, y)) return;
          rosters[i].delete(mine);
          rosters[i].add(better);
          moves[i]++;
          addTxn(w, { type: "free_agent", roster_ids: [rid(i)], adds: { [better]: rid(i) }, drops: { [mine]: rid(i) }, created: stamp(y, w, 30) });
        });
      }

      /* A trade: two players of about the same worth in their owners' eyes,
         sometimes with a draft pick to even it up. Hindsight decides who
         won it. */
      function trade(w) {
        const a = pick(ids);
        if (!chance(MANAGERS[a].deals)) return;
        const b = pick(ids.filter((x) => x !== a));
        const tradeable = (i) => [...rosters[i]].filter((pid) => !anchored.has(pid) && posOf(pid) !== "DEF" && inLeague(pid) && value(pid, y, rid(i)) > 7);
        const mineA = tradeable(a), mineB = tradeable(b);
        for (const x of shuffle(mineA)) {
          const vx = value(x, y, rid(a));
          const y2 = shuffle(mineB).find((p2) => posOf(p2) !== posOf(x) && Math.abs(value(p2, y, rid(b)) - vx) / vx < 0.18);
          if (!y2) continue;
          // both lineups still filled afterwards, and no one over a cap
          const ca = counts(rosters[a]), cb = counts(rosters[b]);
          if (ca[posOf(x)] - 1 < MINS[posOf(x)] || cb[posOf(y2)] - 1 < MINS[posOf(y2)]) continue;
          if (ca[posOf(y2)] + 1 > CAPS[posOf(y2)] || cb[posOf(x)] + 1 > CAPS[posOf(x)]) continue;
          rosters[a].delete(x); rosters[b].delete(y2);
          rosters[a].add(y2); rosters[b].add(x);
          const picks = [];
          if (chance(0.4)) {
            const giver = value(y2, y, rid(b)) > vx ? a : b;
            const taker = giver === a ? b : a;
            const season = y + 1, round = chance(0.25) ? 1 : int(2, 3);
            const orig = rid(giver);
            if (ownerOfPick(season, round, orig) === rid(giver)) {
              pickOwner.set(`${season}.${round}.${orig}`, rid(taker));
              const pk = { season: String(season), round, roster_id: orig, previous_owner_id: rid(giver), owner_id: rid(taker) };
              picks.push(pk);
              tradedPicks.push(pk);
            }
          }
          moves[a]++; moves[b]++;
          addTxn(w, {
            type: "trade", roster_ids: [rid(a), rid(b)],
            adds: { [x]: rid(b), [y2]: rid(a) }, drops: { [x]: rid(a), [y2]: rid(b) },
            draft_picks: picks, created: stamp(y, w, int(30, 140)),
          });
          return;
        }
      }

      /* ---- the regular season and the playoffs ---- */
      const entry = (i, w, matchupId, scored) => {
        const starters = setLineup(i, w);
        lineups[i] = starters;
        const players = [...rosters[i]];
        const pp = {};
        players.forEach((pid) => { pp[pid] = scored ? scoreOf(pid, w) : 0; });
        const sp = starters.map((pid) => (scored && pid !== "0" ? scoreOf(pid, w) : 0));
        const pts = r2(sp.reduce((s, v) => s + v, 0));
        return { roster_id: rid(i), matchup_id: matchupId, points: pts, custom_points: null, starters, starters_points: sp, players, players_points: pp };
      };

      // An offseason trade or two before week 1, then the weeks.
      if (y > 2022) { trade(1); trade(1); }
      for (let w = 1; w <= REGULAR; w++) {
        const scored = w <= lastPlayed;
        if (w <= (y === NOW ? THROUGH + 1 : LAST_WEEK)) {
          if (w > 1 || y === 2022) waivers(w);
          if (w >= 2 && w <= TRADE_DEADLINE && w <= (y === NOW ? THROUGH + 1 : LAST_WEEK)) { trade(w); if (chance(0.35)) trade(w); }
        }
        const list = [];
        schedule[w].forEach(([a, b], k) => {
          const ea = entry(a, w, k + 1, scored), eb = entry(b, w, k + 1, scored);
          list.push(ea, eb);
          if (!scored) return;
          [[a, ea, eb], [b, eb, ea]].forEach(([i, me, them]) => {
            const r = record[i];
            r.pf += me.points; r.pa += them.points; r.ppts += bestPoints(i, w);
            if (me.points > them.points) { r.wins++; r.log += "W"; } else if (me.points < them.points) { r.losses++; r.log += "L"; } else { r.ties++; r.log += "T"; }
          });
        });
        matchups[w] = list.sort((x, z) => x.roster_id - z.roster_id);
      }

      // Seeds: wins, then points for.
      const seeds = ids.slice().sort((a, b) => (record[b].wins + record[b].ties / 2) - (record[a].wins + record[a].ties / 2) || record[b].pf - record[a].pf);
      const seedRid = (n) => rid(seeds[n - 1]);
      const finished = y < NOW;
      const winners = [
        { r: 1, m: 1, t1: seedRid(4), t2: seedRid(5) },
        { r: 1, m: 2, t1: seedRid(3), t2: seedRid(6) },
        { r: 2, m: 3, t1: seedRid(1), t2: null, t2_from: { w: 1 } },
        { r: 2, m: 4, t1: seedRid(2), t2: null, t2_from: { w: 2 } },
        { r: 2, m: 5, p: 5, t1: null, t2: null, t1_from: { l: 1 }, t2_from: { l: 2 } },
        { r: 3, m: 6, p: 1, t1: null, t2: null, t1_from: { w: 3 }, t2_from: { w: 4 } },
        { r: 3, m: 7, p: 3, t1: null, t2: null, t1_from: { l: 3 }, t2_from: { l: 4 } },
      ];
      // The toilet bowl: the team that LOSES goes on, and the last one
      // standing finishes last.
      const losers = [
        { r: 1, m: 1, t1: seedRid(7), t2: seedRid(10) },
        { r: 1, m: 2, t1: seedRid(8), t2: seedRid(9) },
        { r: 2, m: 3, p: 1, t1: null, t2: null, t1_from: { w: 1 }, t2_from: { w: 2 } },
        { r: 2, m: 4, p: 3, t1: null, t2: null, t1_from: { l: 1 }, t2_from: { l: 2 } },
      ];
      [...winners, ...losers].forEach((g) => { g.w = null; g.l = null; });
      const place = {};
      if (finished) {
        const game = (bracket, g) => {
          if (g.t1_from) g.t1 = bracket.find((x) => x.m === (g.t1_from.w || g.t1_from.l))[g.t1_from.w ? "w" : "l"];
          if (g.t2_from) g.t2 = bracket.find((x) => x.m === (g.t2_from.w || g.t2_from.l))[g.t2_from.w ? "w" : "l"];
        };
        const playWeek = (w) => {
          if (w > REGULAR) waivers(w);
          const games = [];
          winners.filter((g) => PLAYOFF_START + g.r - 1 === w).forEach((g) => { game(winners, g); games.push(["W", g]); });
          losers.filter((g) => PLAYOFF_START + g.r - 1 === w).forEach((g) => { game(losers, g); games.push(["L", g]); });
          const list = [];
          const inGame = new Set();
          games.forEach(([bracket, g], k) => {
            const a = g.t1 - 1, b = g.t2 - 1;
            inGame.add(a); inGame.add(b);
            const ea = entry(a, w, k + 1, true), eb = entry(b, w, k + 1, true);
            list.push(ea, eb);
            const aWon = ea.points >= eb.points;
            const [won, lost] = aWon ? [g.t1, g.t2] : [g.t2, g.t1];
            // In the toilet bowl, Sleeper sends the loser on.
            if (bracket === "L") { g.w = lost; g.l = won; } else { g.w = won; g.l = lost; }
          });
          ids.filter((i) => !inGame.has(i)).forEach((i) => list.push(entry(i, w, null, true)));
          matchups[w] = list.sort((x, z) => x.roster_id - z.roster_id);
        };
        for (let w = PLAYOFF_START; w <= LAST_WEEK; w++) playWeek(w);
        winners.filter((g) => g.p).forEach((g) => { place[g.w] = g.p; place[g.l] = g.p + 1; });
        losers.filter((g) => g.p).forEach((g) => { place[g.w] = TEAMS_N - g.p + 1; place[g.l] = TEAMS_N - g.p; });
        prevFinal = place;
      } else {
        // The season being played: the bracket as it would start today,
        // later weeks only a schedule.
        for (let w = PLAYOFF_START; w <= LAST_WEEK; w++) matchups[w] = ids.map((i) => entry(i, w, null, false));
      }

      /* ---- writing it out in Sleeper's shapes ---- */
      const champion = finished ? winners.find((g) => g.p === 1).w : null;
      const league = {
        league_id: lid, previous_league_id: y === 2022 ? null : leagueId(y - 1),
        name: LEAGUE_NAME, avatar: null, season: String(y), season_type: "regular", sport: "nfl",
        status: finished ? "complete" : "in_season", total_rosters: TEAMS_N,
        draft_id: `demo-draft-${y}`, company_id: null, bracket_id: null, loser_bracket_id: null,
        roster_positions: [...SLOTS, ...Array(ROSTER - SLOTS.length).fill("BN")],
        scoring_settings: { rec: 1, pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec_yd: 0.1, rec_td: 6, fum_lost: -2 },
        settings: {
          num_teams: TEAMS_N, type: 2, playoff_teams: 6, playoff_week_start: PLAYOFF_START, playoff_round_type: 0,
          playoff_type: 0, playoff_seed_type: 0, start_week: 1, divisions: 0, league_average_match: 0,
          waiver_type: 2, waiver_budget: BUDGET, waiver_bid_min: 0, trade_deadline: TRADE_DEADLINE, draft_rounds: 3,
          taxi_slots: 0, reserve_slots: 0, pick_trading: 1, bench_lock: 0, best_ball: 0,
          leg: finished ? LAST_WEEK : THROUGH + 1, last_scored_leg: finished ? LAST_WEEK : THROUGH, last_report: finished ? LAST_WEEK : THROUGH,
        },
        metadata: { auto_continue: "on", latest_league_winner_roster_id: champion ? String(champion) : null },
      };
      put(`/league/${lid}`, league);
      put(`/league/${lid}/users`, MANAGERS.map((m, i) => ({
        user_id: userId(i), display_name: m.name, username: m.name.toLowerCase(), avatar: null, is_bot: false,
        is_owner: i === 0, league_id: lid, settings: null,
        metadata: { team_name: teamName(i, y), avatar: logo(i, y) },
      })));
      put(`/league/${lid}/rosters`, MANAGERS.map((m, i) => {
        const r = record[i];
        const split = (n) => [Math.floor(n), Math.round((n - Math.floor(n)) * 100)];
        const [fp, fpd] = split(r2(r.pf)), [fa, fad] = split(r2(r.pa)), [pp, ppd] = split(r2(r.ppts));
        const tail = r.log.match(/(W+|L+|T+)$/);
        return {
          roster_id: rid(i), owner_id: userId(i), league_id: lid, co_owners: null, keepers: null, player_map: null,
          players: [...rosters[i]], starters: lineups[i], reserve: null, taxi: null,
          settings: {
            wins: r.wins, losses: r.losses, ties: r.ties, fpts: fp, fpts_decimal: fpd, fpts_against: fa, fpts_against_decimal: fad,
            ppts: pp, ppts_decimal: ppd, waiver_budget_used: budgetUsed[i], total_moves: moves[i], waiver_position: i + 1, division: 0,
          },
          metadata: { record: r.log, streak: tail ? `${tail[0].length}${tail[0][0]}` : "" },
        };
      }));
      put(`/league/${lid}/winners_bracket`, winners);
      put(`/league/${lid}/losers_bracket`, losers);
      for (let w = 1; w <= LAST_WEEK; w++) {
        put(`/league/${lid}/matchups/${w}`, matchups[w] || []);
        put(`/league/${lid}/transactions/${w}`, transactions[w] || []);
      }
      put(`/league/${lid}/drafts`, drafts.map((d) => draftOf(d, y, lid)));
      drafts.forEach((d) => {
        put(`/draft/${d.id}`, draftOf(d, y, lid));
        put(`/draft/${d.id}/picks`, d.picks.map((pk) => ({ ...pk, draft_id: d.id, is_keeper: null, metadata: { position: posOf(pk.player_id) } })));
      });
      if (y === NOW) {
        put(`/league/${lid}/traded_picks`, tradedPicks.filter((pk) => Number(pk.season) > NOW));
      }
    }
    return api;
  }

  function draftOf(d, y, lid) {
    const slotToRoster = {};
    const draftOrder = {};
    d.order.forEach((i, k) => { slotToRoster[k + 1] = i + 1; draftOrder[userId(i)] = k + 1; });
    return {
      draft_id: d.id, league_id: lid, season: String(y), season_type: "regular", sport: "nfl", status: "complete", type: d.type,
      start_time: d.start, last_picked: d.start + 3600e3, created: d.start - 864e5,
      settings: { rounds: d.rounds, teams: TEAMS_N, player_type: d.type === "snake" ? 0 : 1, pick_timer: 3600 },
      metadata: { name: LEAGUE_NAME, scoring_type: "ppr", description: d.type === "snake" ? "Startup draft" : "Rookie draft" },
      draft_order: draftOrder, slot_to_roster_id: slotToRoster,
    };
  }

  /* Team logos: the team's initials on its colour, as a picture. */
  function initials(name) {
    const words = name.split(/\s+/).filter((w) => /^[A-Z]/.test(w));
    return (words.length ? words.slice(0, 2).map((w) => w[0]).join("") : name[0]).toUpperCase();
  }
  function svgMark(label, color, round) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs><rect width="256" height="256" rx="${round ? 128 : 56}" fill="url(#g)"/><circle cx="128" cy="128" r="104" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="6"/><text x="128" y="152" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="${label.length > 1 ? 88 : 108}" fill="#fff">${label}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
  const logo = (i, y) => svgMark(initials(teamName(i, y)), MANAGERS[i].color, true);
  const LEAGUE_LOGO = svgMark("SS", "#0f2a4a", false);

  /* ------------------------------------------------------------ answering */

  let api = null;
  const STATE = {
    week: THROUGH + 1, leg: THROUGH + 1, display_week: THROUGH + 1, season: String(NOW), league_season: String(NOW),
    previous_season: String(NOW - 1), season_type: "regular", season_start_date: KICKOFF[NOW],
    league_create_season: String(NOW), season_has_scores: true,
  };

  /* A path under Sleeper's API ("/league/demo-2024/matchups/3"): the
     answer Sleeper would give, or null where it would answer 404. A league
     id of an earlier season is answered as that season's league. */
  function answer(path) {
    if (!api) api = simulate();
    const value = api.get(path);
    return value === undefined ? null : JSON.parse(JSON.stringify(value));
  }

  window.DemoLeague = {
    id: "demo",
    name: LEAGUE_NAME,
    logo: LEAGUE_LOGO,
    state: STATE,
    years: YEARS.slice(),
    yearOf,
    answer,
  };
})();
