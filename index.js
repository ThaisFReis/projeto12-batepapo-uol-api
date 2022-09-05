import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import joi from "joi"
import dotenv from "dotenv";
import dayjs from "dayjs";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Banco de dados
let db = null;
const MongoClient = new MongoClient(process.env.Mongo_DB_URI);
const promise = MongoClient.connect().then(() => {
    db = MongoClient.db(process.env.MONGO_DATABASE_NAME)
})
promise.catch(err =>  {
    console.log("Banco de dados não conectou!")
})

app.post("/users", async (req, res) => {
    const user = req.body;

    // Validação do user
    const userSchema = joi.object({
        name: joi.string().required(),
    })

    // Erro 422 se o user for string vazia
    const {error} = userSchema.validate(user);
    if (error){
        res.status(422).json({error: error.details[0].message})
        return;
    }

    try {
        const userExists = await db.collection("users").findOne({name: user.name});
        
        // Erro 409 se o user for string vazia
        if (userExists){
            res.status(409).json({
                error: "Nome já existe"})
                return;
        }

        // Salvar o user no banco de dados
        await db.collection("users").insertOne({name: user.name, lastStatus: Date.now() });

        // Salvar no Mongo formato da mensagem
        await db.collection("messages").insertOne({
            from: user.name,
            to: "Todos",
            text: "entrou na sala...",
            type: "status",
            time: dayjs().format("HH:MM:SS")
        })

        res.status(201).json({message: "Entrou na sala!"})
    } 
    
    // Tive que colocar o catch para não dar erro 
    catch (error){
        res.status(500).json({error: "Erro interno do servidor!"})
    }
})


//Retornar a lista de todos os usuários
app.get("/users", async (req,res) => {
    try {
        const users = await db.collection("users").find();
        res.status(200).json(users)
    } catch (error) {
        res.status(500).json({error: "Erro interno do servidor!"})
    }
})

//Receber os parâmetros to, text e type
app.post("/messages", async(res, req) => {
    const message = req.body;
    const { User } = req.headersSent;

    //Validação se to e text não são strings vazias, se o type é "message" ou "private_message" e se o from é um usuário válido
    const messageSchema = joi.object({
        to: joi.string().required(),
        text: joi.string().required(),
        type: joi.string().valid("message", "private_message").required()
    })

    const {error} = messageSchema.validate(message)

    if (error){
        res.status(422).json({error: error.details[0].message})
        return;
    }

    try {
        const user = await db.collection("users").findOne({name: User});
            if (!user){
                res.status(422).json({error: "Usuário inválido!"})
                return;
            }

            const {to, text, type} = message;
            await db.collection("messages").insertOne({
                to, 
                text,
                type,
                from: User,
                time: dayjs().format("HH:MM:SS")
            })

            res.status(201).json({message: "Tudo certo"})
        } catch (error) {
            res.status(500).json({error: "Erro interno do servidor!"})
        }
})

app.get("/messages", async (req, res) => {

    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    const { User } = req.headers;

    try {
        const messages = await db.collection("messages").find().sort({time: -1 /*Decrescente*/ }).limit(limit).toArray();

        const filteredMessages = messages.filter( message => {
            const {to, type, from} = message;
            const toUser = to === "Todos" || from === User || to === User;
            const toPublic = type === "message";

            return toUser || toPublic;
        })

        //Erro ao obter as mensagens
        if (limit !== NaN){
            res.send(filteredMessages)
            return;
        }
    } catch (error) {
        res.status(500).json({error: "Erro interno do servidor!"})
    }
})

app.post("/status", async(req, res) => {
    const { User } = req.headers;
    
    try {
        const user = await db.collection("users").findOne({name: User});

        if (!user){
            res.status(404).json({error: error.details[0].message})
        }

        await db.collection("users").updateOne({name: User}, {$set: {lastStatus: Date.now()}})
        res.status(200).json({message: "Tudo certo"})
    } catch (error){
        res.status(500).json({error: "Erro interno do servidor!"})
    }
})


//Remoção de usuários inativos
setInterval(async () => {
    const seconds = Date.now() - 10 * 1000;

    try {
        const inactiveUsers = await db.collection("users").find({lastStatus: {$lt: seconds}}).toArray();

        if(inactiveUsers.length > 0){
            const inactiveMessages = inactiveUsers.map(inactiveUser => {
                return{
                    from: inactiveUser.name,
                    to: "Todos",
                    text: "saiu da sala...",
                    type: "status",
                    time: dayjs().format("HH:MM:SS")
                }
            })

            await db.collection("messages").insertMany(inactiveMessages);
            await db.collection("users").deleteMany({lastStatus: {$lt: seconds}});
        }
    } catch (error){
        res.sendStatus(500);
        return;
    }

}, 1500)



app.listen(5000, () => {
    console.log("Servidor rodando na porta 5000")
})