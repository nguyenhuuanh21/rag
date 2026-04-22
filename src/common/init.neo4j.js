const { Neo4jGraph } = require("@langchain/community/graphs/neo4j_graph");
const neo4jGraph = new Neo4jGraph({
  url: process.env.NEO4J_URL ,
  username: process.env.NEO4J_USERNAME ,
  password: process.env.NEO4J_PASSWORD,
  database: "4145cfee"
});
module.exports = neo4jGraph; 