-- 创建URL解析函数parse_url
-- 该函数可以解析URL的各个组成部分：协议、主机、端口、路径、查询参数、片段等

CREATE OR REPLACE FUNCTION wecom.parse_url(url_text TEXT)
RETURNS TABLE (
    protocol TEXT,
    host TEXT,
    port INTEGER,
    path TEXT,
    query TEXT,
    fragment TEXT,
    username TEXT,
    password TEXT
) AS $$
DECLARE
    working_url TEXT := url_text;
    temp_text TEXT;
    authority TEXT;
    user_info TEXT;
BEGIN
    -- 初始化所有返回值
    protocol := NULL;
    host := NULL;
    port := NULL;
    path := NULL;
    query := NULL;
    fragment := NULL;
    username := NULL;
    password := NULL;
    
    -- 如果URL为空，直接返回
    IF working_url IS NULL OR working_url = '' THEN
        RETURN NEXT;
        RETURN;
    END IF;
    
    -- 1. 提取fragment（#后面的部分）
    IF position('#' in working_url) > 0 THEN
        fragment := substring(working_url from position('#' in working_url) + 1);
        working_url := substring(working_url from 1 for position('#' in working_url) - 1);
    END IF;
    
    -- 2. 提取query（?后面的部分）
    IF position('?' in working_url) > 0 THEN
        query := substring(working_url from position('?' in working_url) + 1);
        working_url := substring(working_url from 1 for position('?' in working_url) - 1);
    END IF;
    
    -- 3. 提取protocol（://前面的部分）
    IF position('://' in working_url) > 0 THEN
        protocol := substring(working_url from 1 for position('://' in working_url) - 1);
        working_url := substring(working_url from position('://' in working_url) + 3);
        
        -- 4. 提取authority部分（第一个/前面的部分）
        IF position('/' in working_url) > 0 THEN
            authority := substring(working_url from 1 for position('/' in working_url) - 1);
            path := substring(working_url from position('/' in working_url));
        ELSE
            authority := working_url;
            path := '/';
        END IF;
        
        -- 5. 解析authority部分
        IF authority IS NOT NULL AND authority != '' THEN
            -- 检查是否有用户信息（@符号）
            IF position('@' in authority) > 0 THEN
                user_info := substring(authority from 1 for position('@' in authority) - 1);
                authority := substring(authority from position('@' in authority) + 1);
                
                -- 解析用户信息
                IF position(':' in user_info) > 0 THEN
                    username := substring(user_info from 1 for position(':' in user_info) - 1);
                    password := substring(user_info from position(':' in user_info) + 1);
                ELSE
                    username := user_info;
                END IF;
            END IF;
            
            -- 解析主机和端口
            IF position(':' in authority) > 0 THEN
                host := substring(authority from 1 for position(':' in authority) - 1);
                temp_text := substring(authority from position(':' in authority) + 1);
                -- 检查端口是否为数字
                IF temp_text ~ '^[0-9]+$' THEN
                    port := temp_text::INTEGER;
                END IF;
            ELSE
                host := authority;
            END IF;
        END IF;
    ELSE
        -- 没有协议的情况，可能是相对路径
        path := working_url;
    END IF;
    
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- 创建一个简化版本的URL解析函数，返回JSON格式
CREATE OR REPLACE FUNCTION wecom.parse_url_json(url_text TEXT)
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'protocol', p.protocol,
        'host', p.host,
        'port', p.port,
        'path', p.path,
        'query', p.query,
        'fragment', p.fragment,
        'username', p.username,
        'password', p.password
    ) INTO result
    FROM wecom.parse_url(url_text) p;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 创建一个获取URL特定部分的便捷函数
CREATE OR REPLACE FUNCTION wecom.get_url_part(url_text TEXT, part_name TEXT)
RETURNS TEXT AS $$
DECLARE
    result TEXT;
BEGIN
    CASE lower(part_name)
        WHEN 'protocol' THEN
            SELECT p.protocol INTO result FROM wecom.parse_url(url_text) p;
        WHEN 'host' THEN
            SELECT p.host INTO result FROM wecom.parse_url(url_text) p;
        WHEN 'port' THEN
            SELECT p.port::TEXT INTO result FROM wecom.parse_url(url_text) p;
        WHEN 'path' THEN
            SELECT p.path INTO result FROM wecom.parse_url(url_text) p;
        WHEN 'query' THEN
            SELECT p.query INTO result FROM wecom.parse_url(url_text) p;
        WHEN 'fragment' THEN
            SELECT p.fragment INTO result FROM wecom.parse_url(url_text) p;
        WHEN 'username' THEN
            SELECT p.username INTO result FROM wecom.parse_url(url_text) p;
        WHEN 'password' THEN
            SELECT p.password INTO result FROM wecom.parse_url(url_text) p;
        ELSE
            result := NULL;
    END CASE;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 添加函数注释
COMMENT ON FUNCTION wecom.parse_url(TEXT) IS 'URL解析函数，返回URL的各个组成部分';
COMMENT ON FUNCTION wecom.parse_url_json(TEXT) IS 'URL解析函数，返回JSON格式的结果';
COMMENT ON FUNCTION wecom.get_url_part(TEXT, TEXT) IS '获取URL指定部分的便捷函数';

-- 示例用法：
-- SELECT * FROM wecom.parse_url('https://user:pass@example.com:8080/path/to/resource?param1=value1&param2=value2#section1');
-- SELECT wecom.parse_url_json('https://example.com/path?query=value');
-- SELECT wecom.get_url_part('https://example.com:8080/path', 'host');