// server.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const {
  AZURE_OPENAI_ENDPOINT,
  AZURE_OPENAI_API_KEY,
  AZURE_OPENAI_DEPLOYMENT,
  AZURE_OPENAI_API_VERSION,
  AZURE_SEARCH_ENDPOINT,
  AZURE_SEARCH_API_KEY,
  AZURE_SEARCH_INDEX,
} = process.env;

// Function to query Azure Cognitive Search
async function queryAzureSearch(query) {
  try {
    const url = `${AZURE_SEARCH_ENDPOINT}/indexes/${AZURE_SEARCH_INDEX}/docs/search?api-version=2020-06-30`;
    const requestBody = {
      search: query,
      top: 3,           // Retrieve top 3 results
      queryType: "simple" // Specify simple query syntax
    };
    const headers = {
      'Content-Type': 'application/json',
      'api-key': AZURE_SEARCH_API_KEY,
    };
    const response = await axios.post(url, requestBody, { headers });
    return response.data.value;
  } catch (error) {
    console.error("Azure Search error:", error.response?.data || error.message);
    // Return an empty array on error so that the chat can proceed.
    return [];
  }
}

// Helper function to extract JSON from a string.
function extractJson(text) {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  const jsonString = text.substring(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(jsonString);
  } catch (err) {
    console.error("Failed to parse extracted JSON:", err);
    return null;
  }
}

// Helper function to format MySQL result as Markdown using Azure OpenAI.
async function formatMySQLResultAsMarkdown(mysqlResult) {
  // Build a prompt asking the assistant to format the MySQL result into Markdown tables.
  const formattingPrompt = `Please format the following MySQL query result into a well-structured Markdown table(s). 

MySQL Query Result:
\`\`\`json
${JSON.stringify(mysqlResult, null, 2)}
\`\`\`

Format the output using Markdown syntax with proper table headers and rows.`;

  // Prepare the conversation for formatting.
  const messages = [
    { role: 'system', content: "You are a helpful assistant that formats data." },
    { role: 'user', content: formattingPrompt }
  ];

  const url = `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`;
  const requestData = {
    messages,
    max_tokens: 500,
    temperature: 0.3,  // Lower temperature for deterministic formatting.
  };
  const headers = {
    'Content-Type': 'application/json',
    'api-key': AZURE_OPENAI_API_KEY,
  };

  try {
    const response = await axios.post(url, requestData, { headers });
    const markdown = response.data.choices[0].message.content;
    console.log("Formatted Markdown:", markdown);
    return markdown;
  } catch (err) {
    console.error("Error formatting MySQL result as Markdown:", err.response?.data || err.message);
    return null;
  }
}

// POST endpoint for chat
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body; // Expects an array of messages [{ role, content }, ...]
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'No messages provided' });
    }

    // Use the latest user message to query the search index.
    const userMessage = messages[messages.length - 1].content;
    const searchResults = await queryAzureSearch(userMessage);
    let searchContext = "";
    if (searchResults && searchResults.length > 0) {
      searchContext = searchResults
        .map(doc => doc.content || JSON.stringify(doc))
        .join("\n");
    }

    // Prepare an initial system prompt.
    const systemPrompt = `You are an AI assistant specialized in assisting MYSQL users. You are capable of creating MYSQL statements that will return information to answer the users questions.
                        ---
                        The data is stored in a MYSQL database and is structured in the following schema: 
                        Table\tDescription
                        PEDIDO\tThis table stores all individual order data
                        PROVEEDOR\tThis table stores all the provider data
                        PEDIDOMAT\tThis table joins the materials and orders 
                        MATERIAL\tThis table holds a list of materials that can be ordered
                        
                        Full list of all TABLE COLUMNS with their data types and descriptions: 
                        Table.Column\tData Type\tDescription
                        PROVEEDOR.ID\tINT\tProvider ID
                        PROVEEDOR.NAME\tVARCHAR\tProvider name
                        PROVEEDOR.FVAL\tDATE\tValidity date of the provider
                        PROVEEDOR.EMAIL\tVARCHAR\tEmail of the provider
                        PROVEEDOR.PHONE\tVARCHAR\tPhone of the provider
                        PEDIDO.NUMPED\tINT\tOrder ID
                        PEDIDO.IDPROV\tINT\tProvider ID foreign key
                        PEDIDO.FECHA\tDATE\tDate of the order
                        PEDIDOMAT.IDPED\tINT\tID of the pedido table
                        PEDIDOMAT.IDMAT\tINT\tID of the material
                        PEDIDOMAT.CANTIDAD\tINT\tQuantity of the material
                        MATERIAL.ID\tINT\tID of the material
                        MATERIAL.NAME\tVARCHAR\tName of the material
                        MATERIAL.UNPRICE\tINT\tUnit price of the material
                        
                        Table.Column relationships: 
                        1. PROVEEDOR.ID to PEDIDO.IDPROV
                        2. PEDIDO.NUMPED to PEDIDOMAT.IDPED
                        3. PEDIDOMAT.IDMAT to MATERIAL.ID 
                        ---
                        Process:
                        1. Engage the user in a conversation and inquire what they would like to know about the data stored in given Tables and Columns. 
                        2. If the question is unclear, not precise or cannot be answered with the provided tables and columns ask the user for clarification.
                        3. Remember to consider the entire conversation history to maintain context.
                        
                        Response:
                        Once there is enough information available to build an SQL statement that will answer the user's question about the data in database respond with an explanation and the SQL statement in JSON format following the example provided. 
                        ---
                        Example of a user question: what providers exist on my data? 
                        Your Response: 
                        We want to retrieve all the providers that exist on our database.
                        {
                          "SQL": "SELECT * FROM PROVEEDORES"
                        }
                        This query will return all the providers.
                        ---
                        Further instructions: 
                        Pay attention to the data types! If checking if a CHAR column is empty you must use, for example, POSTCODE = '' and not POSTCODE = NULL.
                        Only use the date format YYYY-MM-DD, example: 2023-12-31.
                        In case the flight date FLDATE is part of the result, order by FLDATE.
                        Never choose more than 6 "Table.Column" combinations in the SELECT statement to keep the results readable. 
                        Today is: @{convertTimeZone(utcNow(), 'UTC', 'W. Europe Standard Time', 'yyyy-MM-dd')}`;

    // Build the conversation:
    let conversation = [];
    if (!messages[0] || messages[0].role !== 'system') {
      conversation.push({ role: 'system', content: systemPrompt });
    }
    if (searchContext) {
      conversation.push({ role: 'system', content: `Additional context from our search index:\n${searchContext}` });
    }
    conversation = conversation.concat(messages);

    // Call the Azure OpenAI Chat Completion API.
    const url = `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`;
    const requestData = {
      messages: conversation,
      max_tokens: 500,
      temperature: 0.7,
    };
    const headers = {
      'Content-Type': 'application/json',
      'api-key': AZURE_OPENAI_API_KEY,
    };

    const openaiResponse = await axios.post(url, requestData, { headers });
    const assistantMessage = openaiResponse.data.choices[0].message;
    
    // Check if the response contains a JSON snippet.
    let extractedJson = null;
    let formattedMarkdown = null;
    if (assistantMessage.content && assistantMessage.content.includes('{')) {
      extractedJson = extractJson(assistantMessage.content);
      if (extractedJson && extractedJson.SQL) {
        try {
          // Send the extracted JSON to the MySQL query endpoint.
          const mysqlResponse = await axios.post(
            "http://4.233.150.76:3000/MySQLQueryFunction",
            extractedJson,
            { headers: { "Content-Type": "application/json" } }
          );
          // Append the MySQL API response to the extracted JSON.
          extractedJson.mysqlResult = mysqlResponse.data;
          console.log("Extracted JSON sent to MySQL endpoint:", extractedJson);
          
          // Now pass the MySQL result to the chat API to format as Markdown tables.
          formattedMarkdown = await formatMySQLResultAsMarkdown(mysqlResponse.data);
        } catch (err) {
          console.error("Error processing extracted JSON:", err.response?.data || err.message);
          extractedJson.mysqlResult = { error: "Error calling MySQL endpoint" };
        }
      }
    }
    
    // Debug log final response data.
    console.log("Final response to frontend:", {
      assistantMessage,
      extractedJson,
      formattedMarkdown
    });

    // Send final response to frontend including the formatted Markdown if available.
    res.json({ 
      message: assistantMessage, 
      extractedJson, 
      formattedMarkdown 
    });
  } catch (error) {
    console.error("Error in /api/chat:", error.response?.data || error.message);
    res.status(500).json({ error: "An error occurred while processing your request." });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
