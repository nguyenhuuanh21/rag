const es=require('@elastic/elasticsearch').Client;
const elasticsearchClient = new es({
    node: process.env.ELASTICSEARCH_NODE,
    auth: {
        apiKey: process.env.ELASTICSEARCH_API_KEY
    }
})

module.exports = elasticsearchClient;